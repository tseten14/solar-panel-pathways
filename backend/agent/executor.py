"""Runs one agent tool call and reports what happened.

Server tools read and write SQLite directly. Client tools return
``client_actions`` for the browser to carry out. Deferred client tools hand the
work to the browser and wait — that is how a scan runs visibly on the map
instead of silently on the server.
"""

from __future__ import annotations

import logging
import time
import uuid

import httpx

import solar_store
from agent.schemas import AgentMapContext, PendingConfirmation, ToolResult
from agent.tools import (
    CLIENT_TOOLS,
    DEFERRED_CLIENT_TOOLS,
    DESTRUCTIVE_TOOLS,
    MULTI_SCAN_CONFIRM_THRESHOLD,
    SERVER_TOOLS,
)

_log = logging.getLogger("uvicorn.error")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
GEOCODE_TIMEOUT_S = 15.0
DEFAULT_RADIUS_M = 200.0
MIN_RADIUS_M = 50.0
MAX_RADIUS_M = 800.0


# --- helpers ------------------------------------------------------------------

def _clamp_radius(value: float | None, fallback: float) -> float:
    try:
        radius = float(value) if value is not None else float(fallback)
    except (TypeError, ValueError):
        radius = float(fallback)
    return max(MIN_RADIUS_M, min(MAX_RADIUS_M, radius))


def _as_latlng(value) -> tuple[float, float] | None:
    if isinstance(value, dict):
        value = [value.get("lat"), value.get("lng")]
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        lat, lng = float(value[0]), float(value[1])
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _viewport_center(ctx: AgentMapContext) -> tuple[float, float] | None:
    if ctx.viewportBbox and len(ctx.viewportBbox) == 4:
        west, south, east, north = ctx.viewportBbox
        return (south + north) / 2.0, (west + east) / 2.0
    return None


def _resolve_center(args: dict, ctx: AgentMapContext) -> tuple[float, float] | None:
    """Where the user means: an explicit point, else the placed square, else the view."""
    explicit = _as_latlng(args.get("center"))
    if explicit:
        return explicit
    if ctx.squares:
        placed = _as_latlng(ctx.squares[0])
        if placed:
            return placed
    if ctx.mapCenter:
        center = _as_latlng(ctx.mapCenter)
        if center:
            return center
    return _viewport_center(ctx)


def _resolve_bbox(args: dict, ctx: AgentMapContext) -> list[float] | None:
    bbox = args.get("bbox") or ctx.viewportBbox
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        try:
            return [float(v) for v in bbox]
        except (TypeError, ValueError):
            return None
    return None


def _confirmation(
    session_id: str, tool: str, tool_input: dict, summary: str, impact: dict
) -> PendingConfirmation:
    return PendingConfirmation(
        action_id=str(uuid.uuid4()),
        session_id=session_id,
        tool=tool,
        tool_input=tool_input,
        summary=summary,
        impact=impact,
        created_at=time.time(),
    )


def _detection_brief(feature: dict) -> dict:
    props = feature.get("properties") or {}
    return {
        "id": props.get("id"),
        "confidence": props.get("confidence"),
        "area_m2": props.get("area_m2"),
        "lat": props.get("lat"),
        "lng": props.get("lng"),
        "status": props.get("status"),
    }


# --- server tools --------------------------------------------------------------

def _stats() -> dict:
    con = solar_store.connect()
    try:
        return solar_store.stats(con)
    finally:
        con.close()


def _pending_sorted(limit: int, ascending: bool, max_confidence: float | None = None) -> list[dict]:
    con = solar_store.connect()
    try:
        features = solar_store.query_detections(con, "pending", None)
    finally:
        con.close()
    briefs = [_detection_brief(f) for f in features]
    if max_confidence is not None:
        briefs = [b for b in briefs if (b["confidence"] or 0.0) <= max_confidence]
    briefs.sort(key=lambda b: b["confidence"] or 0.0, reverse=not ascending)
    return briefs[:limit]


async def _resolve_place(name: str) -> ToolResult:
    if not name.strip():
        return ToolResult(ok=False, error="resolve_place needs a place name")
    try:
        async with httpx.AsyncClient(timeout=GEOCODE_TIMEOUT_S) as client:
            res = await client.get(
                NOMINATIM_URL,
                params={"q": name, "format": "json", "limit": 3, "countrycodes": "us"},
                headers={"User-Agent": "SolarTrace/1.0 (research tool; map agent)"},
            )
            res.raise_for_status()
            hits = res.json()
    except httpx.HTTPError as exc:
        return ToolResult(ok=False, error=f"place lookup failed: {exc}")

    if not hits:
        return ToolResult(ok=False, error=f"no place found matching '{name}'")

    results = []
    for hit in hits:
        # Nominatim returns boundingbox as [south, north, west, east] strings.
        try:
            south, north, west, east = (float(v) for v in hit.get("boundingbox", []))
            bbox = [west, south, east, north]
        except (ValueError, TypeError):
            bbox = None
        results.append(
            {
                "name": hit.get("display_name"),
                "lat": float(hit["lat"]),
                "lng": float(hit["lon"]),
                "bbox": bbox,
            }
        )
    return ToolResult(data={"places": results, "best": results[0]})


def _erase_estimate(center: tuple[float, float], radius_m: float) -> ToolResult:
    con = solar_store.connect()
    try:
        ids = solar_store.ids_in_circle(con, center, radius_m)
    except ValueError as exc:
        return ToolResult(ok=False, error=str(exc))
    finally:
        con.close()
    return ToolResult(data={"would_erase": len(ids), "ids": ids, "radius_m": radius_m})


def _set_status(ids: list[int], status: str) -> ToolResult:
    clean = [int(i) for i in ids if isinstance(i, (int, float, str)) and str(i).lstrip("-").isdigit()]
    if not clean:
        return ToolResult(ok=False, error="no detection ids given")
    con = solar_store.connect()
    try:
        updated = solar_store.set_status_batch(con, clean, status)
    finally:
        con.close()
    return ToolResult(data={"updated": updated, "status": status, "ids": clean})


# --- dispatch ------------------------------------------------------------------

async def execute_tool(
    name: str,
    args: dict,
    ctx: AgentMapContext,
    *,
    session_id: str,
    skip_confirmation: bool = False,
) -> ToolResult:
    args = args or {}

    if name not in SERVER_TOOLS and name not in CLIENT_TOOLS and name not in DEFERRED_CLIENT_TOOLS:
        return ToolResult(ok=False, error=f"unknown tool '{name}'")

    # Anything destructive stops here the first time round and asks the user.
    if name in DESTRUCTIVE_TOOLS and not skip_confirmation:
        return await _request_destructive_confirmation(name, args, ctx, session_id)

    try:
        return await _dispatch(name, args, ctx, session_id=session_id, skip_confirmation=skip_confirmation)
    except Exception as exc:  # noqa: BLE001
        _log.exception("agent tool %s failed", name)
        return ToolResult(ok=False, error=f"{name} failed: {exc}")


async def _request_destructive_confirmation(
    name: str, args: dict, ctx: AgentMapContext, session_id: str
) -> ToolResult:
    if name == "erase_in_circle":
        center = _resolve_center(args, ctx)
        if not center:
            return ToolResult(ok=False, error="erase_in_circle needs a centre — none in map context")
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        estimate = _erase_estimate(center, radius)
        count = estimate.data.get("would_erase", 0) if estimate.ok else 0
        return ToolResult(
            requires_confirmation=_confirmation(
                session_id,
                name,
                {"center": list(center), "radius_m": radius},
                f"Erase {count} detection{'' if count == 1 else 's'} within {radius:.0f} m of "
                f"{center[0]:.5f}, {center[1]:.5f}?",
                {"detections": count, "radius_m": radius},
            )
        )

    ids = args.get("ids") or []
    return ToolResult(
        requires_confirmation=_confirmation(
            session_id,
            name,
            {"ids": ids},
            f"Reject {len(ids)} detection{'' if len(ids) == 1 else 's'} as false positives?",
            {"ids": ids},
        )
    )


async def _dispatch(
    name: str,
    args: dict,
    ctx: AgentMapContext,
    *,
    session_id: str,
    skip_confirmation: bool,
) -> ToolResult:
    # --- read-only ---
    if name == "get_detection_stats":
        return ToolResult(data={"stats": _stats()})

    if name == "get_coverage":
        stats = _stats()
        return ToolResult(
            data={"scanned_area_km2": stats["scanned_area_km2"], "scans": stats["scans"]}
        )

    if name == "count_detections_in_bbox":
        bbox = _resolve_bbox(args, ctx)
        if not bbox:
            return ToolResult(ok=False, error="no bbox given and the map viewport is unknown")
        status = args.get("status")
        con = solar_store.connect()
        try:
            features = solar_store.query_detections(con, status, tuple(bbox))
        finally:
            con.close()
        return ToolResult(data={"count": len(features), "bbox": bbox, "status": status or "any"})

    if name == "get_pending_summary":
        limit = int(args.get("limit") or 5)
        rows = _pending_sorted(limit, ascending=False)
        return ToolResult(data={"pending_total": _stats()["pending"], "top": rows})

    if name == "list_low_confidence":
        limit = int(args.get("limit") or 10)
        threshold = float(args.get("max_confidence") or 0.5)
        rows = _pending_sorted(limit, ascending=True, max_confidence=threshold)
        return ToolResult(data={"max_confidence": threshold, "detections": rows})

    if name == "review_next_pending":
        rows = _pending_sorted(1, ascending=False)
        if not rows:
            return ToolResult(data={"pending": 0, "message": "The review queue is empty."})
        target = rows[0]
        return ToolResult(
            data={"detection": target},
            client_actions=[
                {"action": "focus_detection", "params": {"detection_id": target["id"]}},
            ],
        )

    if name == "resolve_place":
        return await _resolve_place(str(args.get("name") or ""))

    if name == "estimate_erase_in_circle":
        center = _resolve_center(args, ctx)
        if not center:
            return ToolResult(ok=False, error="no centre given and none in map context")
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        return _erase_estimate(center, radius)

    # --- writes ---
    if name == "erase_in_circle":
        center = _as_latlng(args.get("center")) or _resolve_center(args, ctx)
        if not center:
            return ToolResult(ok=False, error="erase_in_circle needs a centre")
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        con = solar_store.connect()
        try:
            result = solar_store.erase_in_circle(con, center, radius)
        finally:
            con.close()
        return ToolResult(data={**result, "stats": _stats()})

    if name == "confirm_detections":
        return _set_status(args.get("ids") or ctx.selectedDetectionIds, "confirmed")

    if name == "reject_detections":
        return _set_status(args.get("ids") or ctx.selectedDetectionIds, "rejected")

    if name == "merge_detections":
        ids = [int(i) for i in (args.get("ids") or ctx.selectedDetectionIds)]
        if len(ids) < 2:
            return ToolResult(ok=False, error="merge needs at least two detection ids")
        con = solar_store.connect()
        try:
            result = solar_store.merge_detections(con, ids)
        except KeyError:
            return ToolResult(ok=False, error="one or more detection ids do not exist")
        except ValueError as exc:
            return ToolResult(ok=False, error=str(exc))
        finally:
            con.close()
        return ToolResult(data=result)

    # --- run on the map, wait for the answer ---
    if name == "scan_area":
        if not ctx.sam3Ready:
            return ToolResult(
                ok=False,
                error="SAM 3 is not loaded — set HF_TOKEN in .env and restart the backend.",
            )
        if ctx.busy:
            return ToolResult(ok=False, error="a scan or edit is already running on the map")
        center = _resolve_center(args, ctx)
        if not center:
            return ToolResult(
                ok=False,
                error="no location to scan — ask the user where, or call resolve_place first",
            )
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        return ToolResult(
            deferred_client=True,
            client_actions=[
                {
                    "action": "run_scan",
                    "params": {"center": list(center), "radius_m": radius},
                }
            ],
            data={"center": list(center), "radius_m": radius},
        )

    if name == "scan_multiple_squares":
        if not ctx.sam3Ready:
            return ToolResult(
                ok=False,
                error="SAM 3 is not loaded — set HF_TOKEN in .env and restart the backend.",
            )
        if ctx.busy:
            return ToolResult(ok=False, error="a scan or edit is already running on the map")
        squares = []
        for entry in args.get("squares") or []:
            center = _as_latlng((entry or {}).get("center"))
            if not center:
                continue
            squares.append(
                {
                    "center": list(center),
                    "radius_m": _clamp_radius(
                        (entry or {}).get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M
                    ),
                }
            )
        if not squares:
            return ToolResult(ok=False, error="scan_multiple_squares needs at least one valid square")

        if len(squares) > MULTI_SCAN_CONFIRM_THRESHOLD and not skip_confirmation:
            return ToolResult(
                requires_confirmation=_confirmation(
                    session_id,
                    name,
                    {"squares": squares},
                    f"Scan {len(squares)} squares in sequence? This may take several minutes.",
                    {"squares": len(squares)},
                )
            )

        return ToolResult(
            deferred_client=True,
            client_actions=[{"action": "run_scan_multiple", "params": {"squares": squares}}],
            data={"squares": len(squares)},
        )

    # --- act on the map, no answer needed ---
    if name == "fly_to":
        lat, lng = float(args.get("lat")), float(args.get("lng"))
        params: dict = {"lat": lat, "lng": lng}
        if args.get("zoom") is not None:
            params["zoom"] = float(args["zoom"])
        return ToolResult(
            data={"moved_to": [lat, lng]},
            client_actions=[{"action": "fly_to", "params": params}],
        )

    if name == "set_scan_square":
        center = _as_latlng(args.get("center"))
        if not center:
            return ToolResult(ok=False, error="set_scan_square needs center as [lat, lng]")
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        return ToolResult(
            data={"center": list(center), "radius_m": radius},
            client_actions=[
                {"action": "set_scan_square", "params": {"center": list(center), "radius_m": radius}}
            ],
        )

    if name == "add_scan_squares":
        squares = [c for c in (_as_latlng(s) for s in args.get("squares") or []) if c]
        if not squares:
            return ToolResult(ok=False, error="add_scan_squares needs a list of [lat, lng] points")
        return ToolResult(
            data={"added": len(squares)},
            client_actions=[
                {"action": "add_scan_squares", "params": {"squares": [list(s) for s in squares]}}
            ],
        )

    if name == "clear_scan_squares":
        return ToolResult(
            data={"cleared": True},
            client_actions=[{"action": "clear_scan_squares", "params": {}}],
        )

    if name == "set_scan_radius":
        radius = _clamp_radius(args.get("radius_m"), ctx.radiusM or DEFAULT_RADIUS_M)
        return ToolResult(
            data={"radius_m": radius},
            client_actions=[{"action": "set_scan_radius", "params": {"radius_m": radius}}],
        )

    if name == "set_map_tool":
        tool = str(args.get("tool") or "single")
        if tool not in ("single", "multi", "erase"):
            return ToolResult(ok=False, error="tool must be single, multi or erase")
        return ToolResult(
            data={"tool": tool},
            client_actions=[{"action": "set_map_tool", "params": {"tool": tool}}],
        )

    if name == "focus_detection":
        det_id = int(args.get("detection_id"))
        return ToolResult(
            data={"focused": det_id},
            client_actions=[{"action": "focus_detection", "params": {"detection_id": det_id}}],
        )

    return ToolResult(ok=False, error=f"tool '{name}' is not implemented")
