"""Fetch EPA LMOP landfills and USGS USPVDB solar stats from ArcGIS; cache to JSON with 24h TTL."""
import json
import logging
import time
from pathlib import Path

import httpx

logger = logging.getLogger("uvicorn.error")

CACHE_DIR = Path(__file__).parent / "data" / "cache"
TTL_SECONDS = 24 * 60 * 60
PAGE_SIZE = 2000

LMOP_URL = (
    "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services"
    "/New_Landfills/FeatureServer/0/query"
)
USPVDB_URL = (
    "https://energy.usgs.gov/arcgis/rest/services/Hosted/uspvdbDyn/FeatureServer/0/query"
)

LANDFILLS_CACHE = CACHE_DIR / "landfills.json"
SOLAR_STATS_CACHE = CACHE_DIR / "solar_stats.json"


def _is_stale(path: Path) -> bool:
    if not path.exists():
        return True
    age = time.time() - path.stat().st_mtime
    return age >= TTL_SECONDS


async def _paginate_arcgis(client: httpx.AsyncClient, base_url: str, params: dict) -> list:
    all_features: list = []
    offset = 0

    while True:
        search = {
            "f": "json",
            **params,
            "resultRecordCount": str(PAGE_SIZE),
            "resultOffset": str(offset),
        }
        resp = await client.get(base_url, params=search)
        resp.raise_for_status()
        data = resp.json()
        if data.get("error", {}).get("message"):
            raise RuntimeError(data["error"]["message"])

        features = data.get("features") or []
        all_features.extend(features)

        if not data.get("exceededTransferLimit") or len(features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return all_features


async def _fetch_landfills() -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        features = await _paginate_arcgis(
            client,
            LMOP_URL,
            {
                "where": "latitude IS NOT NULL AND longitude IS NOT NULL",
                "outFields": (
                    "OBJECTID,landfill_name,county_state,landfill_owner_org,"
                    "current_landfill_status,latitude,longitude,"
                    "landfill_design_cap,waste_in_place_tons"
                ),
                "returnGeometry": "false",
            },
        )
    return {"features": features, "fetched_at": time.time()}


async def _fetch_solar_stats() -> dict:
    out_statistics = json.dumps(
        [
            {"statisticType": "sum", "onStatisticField": "p_cap_dc", "outStatisticFieldName": "total_mw"},
            {"statisticType": "count", "onStatisticField": "p_name", "outStatisticFieldName": "facility_count"},
        ]
    )
    search = {
        "where": "1=1",
        "outStatistics": out_statistics,
        "groupByFieldsForStatistics": "p_state",
        "f": "json",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(USPVDB_URL, params=search)
        resp.raise_for_status()
        data = resp.json()
        if data.get("error", {}).get("message"):
            raise RuntimeError(data["error"]["message"])

    return {"features": data.get("features") or [], "fetched_at": time.time()}


def _write_cache(path: Path, payload: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _read_cache(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


async def refresh_landfills() -> dict:
    logger.info("Refreshing landfills cache from ArcGIS")
    payload = await _fetch_landfills()
    _write_cache(LANDFILLS_CACHE, payload)
    return payload


async def refresh_solar_stats() -> dict:
    logger.info("Refreshing solar stats cache from ArcGIS")
    payload = await _fetch_solar_stats()
    _write_cache(SOLAR_STATS_CACHE, payload)
    return payload


async def refresh_if_stale() -> None:
    if _is_stale(LANDFILLS_CACHE):
        try:
            await refresh_landfills()
        except Exception:
            logger.exception("Failed to refresh landfills cache on startup")
    if _is_stale(SOLAR_STATS_CACHE):
        try:
            await refresh_solar_stats()
        except Exception:
            logger.exception("Failed to refresh solar stats cache on startup")


def get_landfills() -> dict:
    if not LANDFILLS_CACHE.exists():
        raise FileNotFoundError("Landfills cache not available")
    return _read_cache(LANDFILLS_CACHE)


def get_solar_stats() -> dict:
    if not SOLAR_STATS_CACHE.exists():
        raise FileNotFoundError("Solar stats cache not available")
    return _read_cache(SOLAR_STATS_CACHE)


def cache_status() -> dict:
    landfills_ok = LANDFILLS_CACHE.exists()
    solar_ok = SOLAR_STATS_CACHE.exists()
    landfills_at = None
    solar_at = None
    if landfills_ok:
        payload = _read_cache(LANDFILLS_CACHE)
        landfills_at = payload.get("fetched_at")
    if solar_ok:
        payload = _read_cache(SOLAR_STATS_CACHE)
        solar_at = payload.get("fetched_at")
    return {
        "cache_landfills": landfills_ok,
        "cache_solar": solar_ok,
        "landfills_fetched_at": landfills_at,
        "solar_fetched_at": solar_at,
    }
