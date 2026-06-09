# FastAPI backend for scene detection: SAM 3 and YOLO (World + COCO fallback; compare via ?engine=sam3|yolo).
# Exposes /detect for uploaded images and /streetview for fetching street view imagery.
import logging

import httpx
from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from config import cache_refresh_secret, cors_origins, google_maps_api_key, max_upload_bytes
from data_cache import (
    cache_status,
    get_landfills,
    get_solar_stats,
    refresh_if_stale,
    refresh_landfills,
    refresh_solar_stats,
)
from sam3_service import is_sam3_loaded, load_sam3, run_detection
from yolo_service import is_yolo_loaded, load_yolo, run_yolo_detection

logger = logging.getLogger("uvicorn.error")


app = FastAPI(
    title="CV-SCAN-GEOAI Detection API",
    description="Scene detection via SAM 3 or YOLO (YOLO-World when local weights exist, else YOLOv8 COCO)",
)


@app.on_event("startup")
async def startup():
    try:
        load_sam3()
    except Exception as e:
        logger.warning(f"SAM 3 preload skipped: {e}")

    try:
        load_yolo()
    except Exception as e:
        logger.warning(f"YOLO preload skipped: {e}")

    try:
        await refresh_if_stale()
    except Exception as e:
        logger.warning(f"Data cache refresh skipped: {e}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    status = cache_status()
    return {
        "status": "ok",
        "sam3_loaded": is_sam3_loaded(),
        "yolo_available": is_yolo_loaded(),
        "cache_landfills": status["cache_landfills"],
        "cache_solar": status["cache_solar"],
        "streetview_configured": google_maps_api_key() is not None,
        "landfills_fetched_at": status["landfills_fetched_at"],
        "solar_fetched_at": status["solar_fetched_at"],
    }


@app.get("/landfills")
async def landfills():
    try:
        return get_landfills()
    except FileNotFoundError:
        raise HTTPException(503, "Landfills cache not available yet")
    except Exception as e:
        logger.exception("Failed to read landfills cache")
        raise HTTPException(500, f"Failed to read landfills cache: {e}")


@app.get("/solar/stats")
async def solar_stats():
    try:
        return get_solar_stats()
    except FileNotFoundError:
        raise HTTPException(503, "Solar stats cache not available yet")
    except Exception as e:
        logger.exception("Failed to read solar stats cache")
        raise HTTPException(500, f"Failed to read solar stats cache: {e}")


@app.post("/cache/refresh")
async def cache_refresh(
    x_cache_refresh_secret: str | None = Header(default=None, alias="X-Cache-Refresh-Secret"),
):
    secret = cache_refresh_secret()
    if secret and x_cache_refresh_secret != secret:
        raise HTTPException(401, "Invalid cache refresh secret")

    results: dict[str, str] = {}
    try:
        await refresh_landfills()
        results["landfills"] = "refreshed"
    except Exception as e:
        logger.exception("Landfills cache refresh failed")
        results["landfills"] = f"error: {e}"

    try:
        await refresh_solar_stats()
        results["solar"] = "refreshed"
    except Exception as e:
        logger.exception("Solar stats cache refresh failed")
        results["solar"] = f"error: {e}"

    return {"status": "ok", "results": results}


@app.get("/streetview-image")
async def streetview_image(
    lat: float = Query(...),
    lng: float = Query(...),
    heading: float = Query(0),
):
    import math

    api_key = google_maps_api_key()
    if not api_key:
        raise HTTPException(
            503,
            "Street View is not configured. Set GOOGLE_MAPS_API_KEY in the environment.",
        )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        async with httpx.AsyncClient(timeout=20, headers=headers, follow_redirects=True) as client:
            meta_url = (
                f"https://maps.googleapis.com/maps/api/streetview/metadata"
                f"?location={lat},{lng}&source=outdoor&key={api_key}"
            )
            meta_resp = await client.get(meta_url)
            if meta_resp.status_code != 200:
                raise HTTPException(502, "Street view metadata lookup failed")

            import json

            meta = json.loads(meta_resp.text)
            if meta.get("status") != "OK":
                raise HTTPException(
                    404,
                    "No street view panorama found near this location. "
                    "Try dropping the pin on a road.",
                )

            pano_id = meta["pano_id"]
            pano_lat = meta.get("location", {}).get("lat", lat)
            pano_lng = meta.get("location", {}).get("lng", lng)

            d_lat = lat - pano_lat
            d_lng = lng - pano_lng
            if abs(d_lat) > 1e-7 or abs(d_lng) > 1e-7:
                face_heading = math.degrees(math.atan2(d_lng, d_lat)) % 360
            else:
                face_heading = heading

            logger.info(f"Resolved pano_id={pano_id}, heading={face_heading:.1f}° for ({lat}, {lng})")

            thumb_url = (
                f"https://streetviewpixels-pa.googleapis.com/v1/thumbnail"
                f"?panoid={pano_id}"
                f"&cb_client=search.revgeo_and_hierarchicalsearch.geoname"
                f"&w=640&h=640"
                f"&yaw={face_heading}&pitch=0&thumbfov=90"
            )
            img_resp = await client.get(thumb_url)
            if img_resp.status_code != 200:
                raise HTTPException(502, "Failed to fetch street view image")

            content_type = img_resp.headers.get("content-type", "")
            if "image" not in content_type:
                raise HTTPException(502, "Street view returned non-image response")

            return Response(content=img_resp.content, media_type="image/jpeg")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Street view fetch failed")
        raise HTTPException(502, f"Street view fetch failed: {e}")


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    mode: str = Query("streetview", pattern="^(streetview|satellite)$"),
    engine: str = Query("sam3", pattern="^(sam3|yolo)$"),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image (jpeg, png, webp)")

    try:
        image_bytes = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Failed to read file: {e}")

    if len(image_bytes) == 0:
        raise HTTPException(400, "Empty file")

    limit = max_upload_bytes()
    if len(image_bytes) > limit:
        raise HTTPException(
            413,
            f"Image exceeds maximum upload size ({limit // (1024 * 1024)} MB)",
        )

    logger.info("POST /detect mode=%s engine=%s bytes=%s", mode, engine, len(image_bytes))

    try:
        if engine == "yolo":
            return run_yolo_detection(image_bytes, mode=mode)
        return run_detection(image_bytes, mode=mode)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Detection failed")
        raise HTTPException(500, f"Detection failed: {str(e)}")
