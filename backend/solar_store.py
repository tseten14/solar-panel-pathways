# SQLite persistence for solar-panel-array scans and human review.
#
# Ported from the building-footprint reference's scan_store.py pattern, retargeted:
#   - dynamic per-scan UTM projection (nationwide US coverage, not one fixed zone)
#   - solar-specific shape filter instead of vegetation/open-field pixel classification
#   - coverage reported as absolute km² scanned (no fixed island-boundary denominator)
#   - no Microsoft-footprints-diff equivalent (no baseline dataset for solar arrays)
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from shapely.geometry import Point, box, mapping, shape
from shapely.strtree import STRtree

from solar_geometry import geometry_metrics, shape_filter_reason, utm_epsg_for
from solar_scan_config import dedup_iou

REVIEW_STATUSES = ("pending", "confirmed", "rejected")

_BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = _BACKEND_DIR / "data" / "solar_scans.db"
SCHEMA_PATH = _BACKEND_DIR / "data" / "schema.sql"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    con.executescript(SCHEMA_PATH.read_text())
    return con


def metrics(geom_wgs) -> dict[str, float]:
    return geometry_metrics(mapping(geom_wgs) if hasattr(geom_wgs, "geom_type") else geom_wgs)


def _auto_filter_reason(m: dict[str, float], tagged_reason: str | None) -> str | None:
    if tagged_reason:
        return tagged_reason
    return shape_filter_reason(m)


def persist_scan(
    con: sqlite3.Connection,
    *,
    model: str,
    bbox: tuple[float, float, float, float],
    center: tuple[float, float] | None,  # (lat, lng)
    radius_m: float | None,
    features: list[dict],
    default_status: str = "pending",
) -> dict:
    if default_status not in ("pending", "confirmed"):
        raise ValueError(f"default_status must be pending or confirmed, got {default_status!r}")

    if center and radius_m:
        clat, clng = center
        scan_epsg = utm_epsg_for(clng, clat)
    else:
        west, south, east, north = bbox
        scan_epsg = utm_epsg_for((west + east) / 2.0, (south + north) / 2.0)

    if center and radius_m:
        clat, clng = center
        from solar_geometry import project_to_utm

        center_m = project_to_utm(shape({"type": "Point", "coordinates": [clng, clat]}), scan_epsg)
        square_m = box(
            center_m.x - radius_m, center_m.y - radius_m, center_m.x + radius_m, center_m.y + radius_m
        )
        from pyproj import Transformer
        from shapely.ops import transform as shp_transform

        to_wgs = Transformer.from_crs(f"EPSG:{scan_epsg}", "EPSG:4326", always_xy=True).transform
        scan_geom = shp_transform(to_wgs, square_m)
    else:
        scan_geom = box(*bbox)

    # Nearby existing (non-rejected) detections — re-scan should only add arrays we
    # never saw. Rejected rows stay eligible for re-detection.
    rows = con.execute(
        "SELECT id, geometry FROM detection"
        " WHERE review_status IN ('pending','confirmed')"
        "   AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
        (bbox[0] - 0.01, bbox[2] + 0.01, bbox[1] - 0.01, bbox[3] + 0.01),
    ).fetchall()
    from solar_geometry import project_to_utm

    existing = [
        {"id": r["id"], "geom": project_to_utm(shape(json.loads(r["geometry"])), scan_epsg)}
        for r in rows
    ]
    tree = STRtree([e["geom"] for e in existing]) if existing else None
    dedup_threshold = dedup_iou()

    counts = {"pending": 0, "confirmed": 0, "skipped": 0, "by_reason": {}}
    ids: list[dict] = []

    with con:
        cur = con.execute(
            "INSERT INTO scanned_area(geometry, model, center_lat, center_lng, radius_m, utm_epsg)"
            " VALUES (?,?,?,?,?,?)",
            (
                json.dumps(mapping(scan_geom)),
                model,
                center[0] if center else None,
                center[1] if center else None,
                radius_m,
                scan_epsg,
            ),
        )
        scan_id = cur.lastrowid

        for f in features:
            props = f.get("properties", {})
            geom = shape(f["geometry"])
            det_model = str(props.get("model") or model)
            confidence = props.get("confidence")
            m = geometry_metrics(f["geometry"])
            reason = _auto_filter_reason(m, props.get("filter_reason"))

            if reason is None and existing:
                geom_m = project_to_utm(geom, scan_epsg)
                hits = tree.query(geom_m, predicate="intersects") if tree is not None else []
                for j in hits:
                    e = existing[int(j)]
                    inter = geom_m.intersection(e["geom"]).area
                    if inter <= 0:
                        continue
                    iou = inter / (geom_m.area + e["geom"].area - inter)
                    if iou >= dedup_threshold:
                        reason = "duplicate"
                        break
                if reason is None:
                    for e in existing:
                        if e["geom"].contains(geom_m.representative_point()) or geom_m.contains(
                            e["geom"].representative_point()
                        ):
                            reason = "duplicate"
                            break

            lng_c, lat_c = geom.centroid.x, geom.centroid.y
            if reason:
                ids.append(
                    {
                        "id": None,
                        "status": "skipped",
                        "filter_reason": reason,
                        "area_m2": m["area_m2"],
                        "compactness": m["compactness"],
                        "lng": round(lng_c, 7),
                        "lat": round(lat_c, 7),
                    }
                )
                counts["skipped"] += 1
                counts["by_reason"][reason] = counts["by_reason"].get(reason, 0) + 1
                continue

            status = default_status
            reviewed_at = "datetime('now')" if status == "confirmed" else "NULL"
            cur = con.execute(
                "INSERT INTO detection(geometry, lng, lat, model, confidence, area_m2,"
                f" compactness, rectangularity, aspect_ratio, scan_id, review_status,"
                f" filter_reason, reviewed_at)"
                f" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,{reviewed_at})",
                (
                    json.dumps(f["geometry"]),
                    lng_c,
                    lat_c,
                    det_model,
                    confidence,
                    m["area_m2"],
                    m["compactness"],
                    m["rectangularity"],
                    m["aspect_ratio"],
                    scan_id,
                    status,
                    None,
                ),
            )
            det_id = cur.lastrowid
            ids.append(
                {
                    "id": det_id,
                    "status": status,
                    "filter_reason": None,
                    "area_m2": m["area_m2"],
                    "compactness": m["compactness"],
                    "lng": round(lng_c, 7),
                    "lat": round(lat_c, 7),
                }
            )
            counts[status] += 1
            geom_m = project_to_utm(geom, scan_epsg)
            existing.append({"id": det_id, "geom": geom_m})
            tree = STRtree([e["geom"] for e in existing])

    return {"scan_id": scan_id, "ids": ids, "counts": counts}


def set_status(con: sqlite3.Connection, det_id: int, status: str) -> dict:
    row = con.execute("SELECT review_status FROM detection WHERE id=?", (det_id,)).fetchone()
    if row is None:
        raise KeyError(det_id)
    reviewed = "datetime('now')" if status in ("confirmed", "rejected") else "NULL"
    with con:
        con.execute(
            f"UPDATE detection SET review_status=?, reviewed_at={reviewed},"
            " filter_reason=CASE WHEN ?='pending' THEN NULL ELSE filter_reason END"
            " WHERE id=?",
            (status, status, det_id),
        )
    return {"id": det_id, "status": status, "previous": row["review_status"]}


def set_status_batch(con: sqlite3.Connection, det_ids: list[int], status: str) -> int:
    reviewed = "datetime('now')" if status in ("confirmed", "rejected") else "NULL"
    q = ",".join("?" * len(det_ids))
    with con:
        cur = con.execute(
            f"UPDATE detection SET review_status=?, reviewed_at={reviewed} WHERE id IN ({q})",
            [status, *det_ids],
        )
    return cur.rowcount


def erase_in_circle(con: sqlite3.Connection, center: tuple[float, float], radius_m: float) -> dict:
    if radius_m <= 0:
        raise ValueError("radius_m must be positive")
    clat, clng = center
    import math

    m_per_deg_lat = 111_320.0
    m_per_deg_lng = 111_320.0 * math.cos(math.radians(clat))
    pad = 1.15
    dlat = (radius_m * pad) / m_per_deg_lat
    dlng = (radius_m * pad) / m_per_deg_lng
    rows = con.execute(
        "SELECT id, lng, lat FROM detection"
        " WHERE review_status IN ('pending','confirmed')"
        "   AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
        (clng - dlng, clng + dlng, clat - dlat, clat + dlat),
    ).fetchall()

    epsg = utm_epsg_for(clng, clat)
    from solar_geometry import project_to_utm

    center_m = project_to_utm(Point(clng, clat), epsg)
    square_m = box(
        center_m.x - radius_m, center_m.y - radius_m, center_m.x + radius_m, center_m.y + radius_m
    )
    erase_ids = [
        int(r["id"])
        for r in rows
        if square_m.contains(project_to_utm(Point(r["lng"], r["lat"]), epsg))
    ]
    if erase_ids:
        set_status_batch(con, erase_ids, "rejected")
    return {"erased": len(erase_ids), "ids": erase_ids}


def merge_detections(con: sqlite3.Connection, det_ids: list[int]) -> dict:
    from shapely.ops import unary_union

    if len(det_ids) < 2:
        raise ValueError("merge requires at least two detection ids")

    unique = sorted({int(i) for i in det_ids})
    placeholders = ",".join("?" * len(unique))
    rows = con.execute(
        f"SELECT id, geometry, confidence, review_status FROM detection WHERE id IN ({placeholders})",
        unique,
    ).fetchall()
    if len(rows) != len(unique):
        raise KeyError("unknown detection id")

    statuses = {r["review_status"] for r in rows}
    if len(statuses) != 1:
        raise ValueError("all detections must share the same status to merge")
    status = statuses.pop()
    if status not in ("pending", "confirmed"):
        raise ValueError("only pending or confirmed detections can be merged")

    geoms = [shape(json.loads(r["geometry"])) for r in rows]
    merged = unary_union(geoms)
    if merged.geom_type == "GeometryCollection":
        polys = [g for g in merged.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            raise ValueError("merge produced no polygon")
        merged = unary_union(polys)
    if merged.geom_type == "MultiPolygon":
        total_area = sum(g.area for g in geoms)
        pieces = sorted(merged.geoms, key=lambda g: g.area, reverse=True)
        discarded_area = sum(g.area for g in pieces[1:])
        if total_area <= 0 or discarded_area / total_area > 0.01:
            raise ValueError(
                "selected detections do not overlap enough to merge into one"
                " array — they produced separate, disjoint shapes"
            )
        merged = pieces[0]
    if merged.geom_type != "Polygon" or merged.is_empty:
        raise ValueError("merge did not produce a single polygon")

    geom_json = json.dumps(mapping(merged))
    m = geometry_metrics(mapping(merged))
    lng_c, lat_c = merged.centroid.x, merged.centroid.y
    max_conf = max((r["confidence"] or 0.0) for r in rows)

    primary_id = unique[0]
    rejected = [i for i in unique if i != primary_id]

    with con:
        con.execute(
            "UPDATE detection SET geometry=?, lng=?, lat=?, area_m2=?, compactness=?,"
            " rectangularity=?, aspect_ratio=?, confidence=? WHERE id=?",
            (
                geom_json, lng_c, lat_c, m["area_m2"], m["compactness"],
                m["rectangularity"], m["aspect_ratio"], max_conf, primary_id,
            ),
        )
        if rejected:
            q = ",".join("?" * len(rejected))
            con.execute(
                f"UPDATE detection SET review_status='rejected', reviewed_at=datetime('now')"
                f" WHERE id IN ({q})",
                rejected,
            )

    return {
        "merged_id": primary_id,
        "rejected_ids": rejected,
        "status": status,
        "area_m2": m["area_m2"],
        "compactness": m["compactness"],
        "lng": round(lng_c, 7),
        "lat": round(lat_c, 7),
    }


def insert_manual_detection(
    con: sqlite3.Connection,
    geometry: dict,
    *,
    model: str = "paint",
    confidence: float | None = None,
    status: str = "pending",
) -> dict:
    if status not in ("pending", "confirmed"):
        raise ValueError("status must be pending or confirmed")
    geom = shape(geometry)
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon" or geom.is_empty:
        raise ValueError("geometry must be a non-empty Polygon")
    m = geometry_metrics(mapping(geom))
    lng_c, lat_c = geom.centroid.x, geom.centroid.y
    reviewed = "datetime('now')" if status == "confirmed" else "NULL"
    with con:
        cur = con.execute(
            "INSERT INTO detection(geometry, lng, lat, model, confidence, area_m2,"
            f" compactness, rectangularity, aspect_ratio, scan_id, review_status,"
            f" filter_reason, reviewed_at)"
            f" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,{reviewed})",
            (
                json.dumps(mapping(geom)), lng_c, lat_c, model, confidence,
                m["area_m2"], m["compactness"], m["rectangularity"], m["aspect_ratio"],
                None, status, None,
            ),
        )
        det_id = cur.lastrowid
    row = con.execute(
        "SELECT id, geometry, lng, lat, model, confidence, area_m2, compactness,"
        " rectangularity, aspect_ratio, scan_id, review_status, filter_reason"
        " FROM detection WHERE id=?",
        (det_id,),
    ).fetchone()
    return detection_feature(row)


def detection_feature(r: sqlite3.Row) -> dict:
    return {
        "type": "Feature",
        "geometry": json.loads(r["geometry"]),
        "properties": {
            "id": r["id"],
            "status": r["review_status"],
            "filter_reason": r["filter_reason"],
            "model": r["model"],
            "detector": r["model"],
            "confidence": r["confidence"],
            "area_m2": r["area_m2"],
            "compactness": r["compactness"],
            "rectangularity": r["rectangularity"],
            "aspect_ratio": r["aspect_ratio"],
            "scan_id": r["scan_id"],
            "lng": r["lng"],
            "lat": r["lat"],
        },
    }


def query_detections(
    con: sqlite3.Connection,
    status: str | None,
    bbox: tuple[float, float, float, float] | None,
) -> list[dict]:
    sql = (
        "SELECT id, geometry, lng, lat, model, confidence, area_m2, compactness,"
        " rectangularity, aspect_ratio, scan_id, review_status, filter_reason FROM detection"
    )
    where, args = [], []
    if status:
        where.append("review_status=?")
        args.append(status)
    if bbox:
        where.append("lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
        args += [bbox[0], bbox[2], bbox[1], bbox[3]]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id"
    return [detection_feature(r) for r in con.execute(sql, args).fetchall()]


def coverage(con: sqlite3.Connection) -> dict:
    # No nationwide equivalent of a fixed island boundary exists, so coverage is
    # reported as absolute scanned area (km²) rather than a percentage.
    from shapely.ops import unary_union

    rows = con.execute("SELECT geometry FROM scanned_area").fetchall()
    if not rows:
        return {"scanned": None, "scanned_area_km2": 0.0}
    geoms = [shape(json.loads(r["geometry"])) for r in rows]
    scanned = unary_union(geoms)
    centroid = scanned.centroid
    epsg = utm_epsg_for(centroid.x, centroid.y)
    from solar_geometry import project_to_utm

    scanned_m = project_to_utm(scanned, epsg)
    return {"scanned": scanned, "scanned_area_km2": round(scanned_m.area / 1_000_000, 4)}


def stats(con: sqlite3.Connection) -> dict:
    by_status = {s: 0 for s in REVIEW_STATUSES}
    for r in con.execute(
        "SELECT review_status s, COUNT(*) n FROM detection GROUP BY review_status"
    ).fetchall():
        if r["s"] in by_status:
            by_status[r["s"]] = r["n"]
    cov = coverage(con)
    return {
        **by_status,
        "total": sum(by_status.values()),
        "scanned_area_km2": cov["scanned_area_km2"],
        "scans": con.execute("SELECT COUNT(*) n FROM scanned_area").fetchone()["n"],
    }
