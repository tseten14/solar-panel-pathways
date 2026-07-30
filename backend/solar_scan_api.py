# Solar-panel scan/review-queue API. Ported from the building-footprint reference's
# review_api.py live-scan subsystem, retargeted for solar arrays and simplified to a
# single in-process backend (this app already imports sam3_service/yolo_service
# directly — no second "model host" service to HTTP-call, unlike the reference).
from __future__ import annotations

import io
import logging
import math
import os
import tempfile
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from shapely.geometry import mapping, shape

import solar_store
from sam3_service import run_detection as sam3_run_detection
from solar_scan_config import ESRI_EXPORT_URL, scan_max_px, scan_target_mpp
from yolo_service import run_yolo_detection

logger = logging.getLogger("uvicorn.error")

router = APIRouter()


# --- Imagery ------------------------------------------------------------------

async def _fetch_esri(bbox: tuple[float, float, float, float], size: tuple[int, int]) -> bytes:
    # Server-side georeferenced satellite JPEG, matching the exact bbox at a
    # controlled resolution — replaces the old client-side DOM-tile-scraping hack.
    west, south, east, north = bbox
    w, h = size
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.get(
            ESRI_EXPORT_URL,
            params={
                "bbox": f"{west},{south},{east},{north}",
                "bboxSR": "4326",
                "imageSR": "4326",
                "size": f"{w},{h}",
                "format": "jpg",
                "f": "image",
            },
        )
        r.raise_for_status()
        return r.content


def _bbox_image_size(bbox: tuple[float, float, float, float]) -> tuple[int, int]:
    west, south, east, north = bbox
    midlat = (south + north) / 2.0
    deg_w = east - west
    deg_h = north - south
    px_per_deg = 111320.0 * math.cos(math.radians(midlat)) / scan_target_mpp()
    w = round(deg_w * px_per_deg)
    h = round(deg_h * px_per_deg)
    longest = max(w, h, 1)
    max_px = scan_max_px()
    if longest > max_px:
        s = max_px / longest
        w, h = round(w * s), round(h * s)
    return max(256, w), max(256, h)


def _circle_bbox(lat: float, lng: float, radius_m: float) -> tuple[float, float, float, float]:
    dlat = radius_m / 111320.0
    dlng = radius_m / (111320.0 * math.cos(math.radians(lat)))
    return (lng - dlng, lat - dlat, lng + dlng, lat + dlat)


# --- In-process model dispatch + georeferencing --------------------------------

def _run_engine(engine: str, image_bytes: bytes) -> dict:
    if engine == "yolo":
        return run_yolo_detection(image_bytes, mode="satellite")
    return sam3_run_detection(image_bytes, mode="satellite")


def _to_geojson_features(result: dict, bbox: tuple[float, float, float, float], engine: str) -> list[dict]:
    # Pixel (0,0) is top-left; the Esri export's bboxSR==imageSR makes the pixel→lonlat
    # map linear, same georeferencing formula as the reference's models/base.py.
    west, south, east, north = bbox
    iw = result.get("image_width") or 0
    ih = result.get("image_height") or 0
    if not iw or not ih:
        raise ValueError(f"{engine}: model reported no image size — cannot georeference")

    features: list[dict] = []
    for i, d in enumerate(result.get("detections", [])):
        poly = d.get("polygon")
        if not poly:
            continue
        ring = [
            [west + (px / iw) * (east - west), north - (py / ih) * (north - south)]
            for px, py in poly
        ]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        lng_c = sum(p[0] for p in ring) / len(ring)
        lat_c = sum(p[1] for p in ring) / len(ring)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "id": f"scan_{i}",
                    "lat": round(lat_c, 7),
                    "lng": round(lng_c, 7),
                    "label": d.get("label"),
                    "confidence": d.get("confidence"),
                    "detector": result.get("engine", engine),
                    "model": engine,
                    "filter_reason": None,
                },
            }
        )
    return features


def _best_feature_at_click(features: list[dict], lat: float, lng: float, max_dist_m: float = 35.0):
    from pyproj import Transformer
    from shapely.geometry import Point
    from shapely.ops import transform as shp_transform

    from solar_geometry import utm_epsg_for

    pt = Point(lng, lat)
    epsg = utm_epsg_for(lng, lat)
    to_m = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    pt_m = shp_transform(to_m, pt)

    containing: list[tuple[float, dict]] = []
    nearest_f = None
    nearest_d = float("inf")
    for f in features:
        try:
            g = shape(f["geometry"])
        except Exception:
            continue
        if g.is_empty:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        if g.contains(pt) or g.intersects(pt.buffer(1e-8)):
            containing.append((g.area, f))
            continue
        d = shp_transform(to_m, g).distance(pt_m)
        if d < nearest_d:
            nearest_d = d
            nearest_f = f
    if containing:
        containing.sort(key=lambda t: t[0])
        return containing[0][1]
    if nearest_f is not None and nearest_d <= max_dist_m:
        return nearest_f
    return None


# --- Request bodies -------------------------------------------------------------

class ScanIn(BaseModel):
    bbox: list[float]  # [west, south, east, north]
    model: str = "sam3"  # sam3 | yolo
    center: list[float] | None = None  # [lat, lng]
    radius_m: float | None = None
    auto_confirm: bool = False


class PaintIn(BaseModel):
    center: list[float]  # [lat, lng]
    radius_m: float = 55


class ManualDetectionIn(BaseModel):
    geometry: dict
    model: str = "paint"
    confidence: float | None = None
    status: str = "pending"


class MergeDetectionsIn(BaseModel):
    ids: list[int]


class BatchDecisionIn(BaseModel):
    ids: list[int]
    status: str = "confirmed"


class EraseCircleIn(BaseModel):
    center: list[float]  # [lat, lng]
    radius_m: float


# --- Endpoints --------------------------------------------------------------

@router.post("/scan")
async def scan(body: ScanIn) -> dict:
    if len(body.bbox) != 4:
        raise HTTPException(400, "bbox must be [west, south, east, north]")
    west, south, east, north = body.bbox
    if west >= east or south >= north:
        raise HTTPException(400, "bbox must have west < east and south < north")
    if body.model not in ("sam3", "yolo"):
        raise HTTPException(400, "model must be sam3 or yolo")

    w, h = _bbox_image_size((west, south, east, north))
    try:
        img = await _fetch_esri((west, south, east, north), (w, h))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"could not fetch satellite imagery: {e}") from e

    try:
        result = _run_engine(body.model, img)
        raw_features = _to_geojson_features(result, (west, south, east, north), body.model)
    except Exception as e:
        raise HTTPException(500, f"{body.model} failed: {e}") from e

    keep_status = "confirmed" if body.auto_confirm else "pending"

    con = solar_store.connect()
    try:
        stored = solar_store.persist_scan(
            con,
            model=body.model,
            bbox=(west, south, east, north),
            center=tuple(body.center) if body.center and len(body.center) == 2 else None,
            radius_m=body.radius_m,
            features=raw_features,
            default_status=keep_status,
        )
    finally:
        con.close()

    kept: list[dict] = []
    for f, meta in zip(raw_features, stored["ids"]):
        if meta["status"] != keep_status:
            continue
        f["properties"].update(
            id=meta["id"],
            status=keep_status,
            area_m2=meta["area_m2"],
            compactness=meta["compactness"],
            lat=meta["lat"],
            lng=meta["lng"],
            scan_id=stored["scan_id"],
        )
        kept.append(f)

    return {
        "type": "FeatureCollection",
        "features": kept,
        "engine": body.model,
        "model": body.model,
        "count": len(kept),
        "scan_id": stored["scan_id"],
        "stored": stored["counts"],
    }


@router.post("/paint")
async def paint(body: PaintIn) -> dict:
    if len(body.center) != 2:
        raise HTTPException(400, "center must be [lat, lng]")
    lat, lng = body.center
    radius = max(25.0, min(float(body.radius_m or 55), 120.0))
    bbox = _circle_bbox(lat, lng, radius)
    w, h = _bbox_image_size(bbox)
    try:
        img = await _fetch_esri(bbox, (w, h))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"could not fetch satellite imagery: {e}") from e

    try:
        result = _run_engine("sam3", img)
        features = _to_geojson_features(result, bbox, "sam3")
    except Exception as e:
        raise HTTPException(500, f"paint failed: {e}") from e

    picked = _best_feature_at_click(features, lat, lng)
    if picked is None:
        raise HTTPException(
            404,
            f"no solar array found near click ({len(features)} candidates in window) — try a clearer roof",
        )

    props = picked.setdefault("properties", {})
    props["model"] = "paint"
    props["detector"] = "paint"
    props["status"] = "preview"
    props["lat"] = lat
    props["lng"] = lng
    m = solar_store.metrics(shape(picked["geometry"]))
    props["area_m2"] = m["area_m2"]
    props["compactness"] = m["compactness"]

    return {
        "type": "FeatureCollection",
        "features": [picked],
        "count": 1,
        "candidates": len(features),
        "model": "sam3",
    }


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
        return (w, s, e, n)
    except ValueError:
        raise HTTPException(400, "bbox must be 'west,south,east,north'") from None


@router.get("/detections")
async def detections(status: str | None = None, bbox: str | None = None) -> dict:
    if status and status not in solar_store.REVIEW_STATUSES:
        raise HTTPException(400, f"status must be one of {list(solar_store.REVIEW_STATUSES)}")
    con = solar_store.connect()
    try:
        features = solar_store.query_detections(con, status, _parse_bbox(bbox))
    finally:
        con.close()
    return {"type": "FeatureCollection", "features": features, "count": len(features)}


def _decide(det_id: int, status: str) -> dict:
    con = solar_store.connect()
    try:
        return solar_store.set_status(con, det_id, status)
    except KeyError:
        raise HTTPException(404, f"unknown detection id {det_id}") from None
    finally:
        con.close()


@router.post("/detections/{det_id}/confirm")
async def confirm_detection(det_id: int) -> dict:
    return _decide(det_id, "confirmed")


@router.post("/detections/{det_id}/reject")
async def reject_detection(det_id: int) -> dict:
    return _decide(det_id, "rejected")


@router.post("/detections/{det_id}/restore")
async def restore_detection(det_id: int) -> dict:
    return _decide(det_id, "pending")


@router.post("/detections/confirm-batch")
async def confirm_batch(body: BatchDecisionIn) -> dict:
    if body.status not in ("confirmed", "rejected", "pending"):
        raise HTTPException(400, "status must be confirmed | rejected | pending")
    if not body.ids:
        return {"updated": 0, "status": body.status}
    con = solar_store.connect()
    try:
        n = solar_store.set_status_batch(con, body.ids, body.status)
    finally:
        con.close()
    return {"updated": n, "status": body.status}


@router.post("/detections/erase-circle")
async def erase_circle(body: EraseCircleIn) -> dict:
    if len(body.center) != 2:
        raise HTTPException(400, "center must be [lat, lng]")
    if body.radius_m <= 0:
        raise HTTPException(400, "radius_m must be positive")
    con = solar_store.connect()
    try:
        return solar_store.erase_in_circle(con, (body.center[0], body.center[1]), body.radius_m)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    finally:
        con.close()


@router.post("/detections/merge")
async def merge_detections_endpoint(body: MergeDetectionsIn) -> dict:
    if len(body.ids) < 2:
        raise HTTPException(400, "merge requires at least two detection ids")
    con = solar_store.connect()
    try:
        return solar_store.merge_detections(con, body.ids)
    except KeyError:
        raise HTTPException(404, "unknown detection id") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    finally:
        con.close()


@router.post("/detections/manual")
async def manual_detection(body: ManualDetectionIn) -> dict:
    if body.status not in ("pending", "confirmed"):
        raise HTTPException(400, "status must be pending | confirmed")
    con = solar_store.connect()
    try:
        return solar_store.insert_manual_detection(
            con,
            body.geometry,
            model=(body.model or "paint").strip() or "paint",
            confidence=body.confidence,
            status=body.status,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    finally:
        con.close()


@router.get("/coverage")
async def coverage() -> dict:
    con = solar_store.connect()
    try:
        cov = solar_store.coverage(con)
    finally:
        con.close()
    features = []
    if cov["scanned"] is not None:
        features.append({"type": "Feature", "geometry": mapping(cov["scanned"]), "properties": {}})
    return {
        "type": "FeatureCollection",
        "features": features,
        "scanned_area_km2": cov["scanned_area_km2"],
    }


@router.get("/detection-stats")
async def detection_stats() -> dict:
    con = solar_store.connect()
    try:
        return solar_store.stats(con)
    finally:
        con.close()


def _confirmed_export_records(features: list[dict]) -> tuple[list[dict], list]:
    features = sorted(features, key=lambda f: int((f.get("properties") or {}).get("id") or 0))
    records: list[dict] = []
    geoms = []
    for i, f in enumerate(features, start=1):
        props = f.get("properties") or {}
        geom = shape(f["geometry"])
        geoms.append(geom)
        lng = props.get("lng")
        lat = props.get("lat")
        if lng is None or lat is None:
            c = geom.centroid
            lng, lat = c.x, c.y
        records.append(
            {
                "OBJECTID": i,
                "det_id": props.get("id"),
                "model": props.get("model"),
                "confidence": props.get("confidence"),
                "area_m2": props.get("area_m2"),
                "compactness": props.get("compactness"),
                "rectangularity": props.get("rectangularity"),
                "aspect_ratio": props.get("aspect_ratio"),
                "scan_id": props.get("scan_id"),
                "lng": float(lng),
                "lat": float(lat),
            }
        )
    return records, geoms


@router.get("/detections/export/confirmed.gpkg")
async def export_confirmed_gpkg() -> Response:
    import geopandas as gpd

    con = solar_store.connect()
    features = solar_store.query_detections(con, "confirmed", None)
    con.close()
    if not features:
        raise HTTPException(404, "No confirmed solar arrays to export")

    records, geoms = _confirmed_export_records(features)
    gdf = gpd.GeoDataFrame(records, geometry=geoms, crs="EPSG:4326")

    fd, path = tempfile.mkstemp(suffix=".gpkg")
    os.close(fd)
    try:
        gdf.to_file(path, driver="GPKG", layer="confirmed_solar_arrays")
        with open(path, "rb") as fh:
            data = fh.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=data,
        media_type="application/geopackage+sqlite3",
        headers={
            "Content-Disposition": f'attachment; filename="confirmed_solar_arrays_{stamp}.gpkg"'
        },
    )


@router.get("/detections/export/confirmed.csv")
async def export_confirmed_csv() -> Response:
    import csv

    con = solar_store.connect()
    features = solar_store.query_detections(con, "confirmed", None)
    con.close()
    if not features:
        raise HTTPException(404, "No confirmed solar arrays to export")

    records, _ = _confirmed_export_records(features)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
    writer.writeheader()
    writer.writerows(records)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="confirmed_solar_arrays_{stamp}.csv"'
        },
    )
