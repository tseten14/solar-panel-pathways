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

import solar_migrate
from solar_geometry import geometry_metrics, shape_filter_reason, utm_epsg_for
from solar_scan_config import dedup_iou

REVIEW_STATUSES = ("pending", "confirmed", "rejected")

_BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = _BACKEND_DIR / "data" / "solar_scans.db"

# Who gets recorded in detection_event when a caller doesn't say.
DEFAULT_ACTOR = "unknown"


# Databases this process has already migrated. Keyed by path, not a single
# boolean: DB_PATH is monkeypatched per test, and a process-wide flag would let
# the second test reuse the first one's "already migrated" answer against a
# different, empty file.
_migrated: set[str] = set()


def connect() -> sqlite3.Connection:
    """Open a connection, migrating each database once per process.

    Schema work used to happen on *every* connect — re-reading schema.sql and
    re-running its DDL for each request and each agent tool call. Migrations are
    now applied once, tracked in schema_migrations (see solar_migrate.py), so an
    ordinary connect is just an open plus a few pragmas.
    """
    path = Path(DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=30.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    # Enforced per connection, not by schema: SQLite defaults this off, and the
    # detection -> scanned_area and detection_event -> detection references are
    # only actually checked when it is on.
    con.execute("PRAGMA foreign_keys=ON")

    key = str(path.resolve())
    if key not in _migrated:
        solar_migrate.migrate(con)
        _migrated.add(key)
    return con


def reset_schema_cache() -> None:
    """Forget which databases have been migrated (used by tests)."""
    _migrated.clear()


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
    actor: str = DEFAULT_ACTOR,
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
    rows = live_rows_in_bbox(
        con,
        (bbox[0] - 0.01, bbox[1] - 0.01, bbox[2] + 0.01, bbox[3] + 0.01),
        columns="id, geometry",
    )
    from solar_geometry import project_to_utm

    existing = [
        {"id": r["id"], "geom": project_to_utm(shape(json.loads(r["geometry"])), scan_epsg)}
        for r in rows
    ]
    tree = STRtree([e["geom"] for e in existing]) if existing else None
    # Detections accepted during this scan. Kept as a plain list because it is
    # short; rebuilding the STRtree per insert was O(n^2) over a growing array.
    added: list = []
    dedup_threshold = dedup_iou()

    counts = {"pending": 0, "confirmed": 0, "skipped": 0, "by_reason": {}}
    ids: list[dict] = []
    # Batched into one executemany at the end of the transaction rather than a
    # round trip per detection.
    created_events: list[tuple[int, str | None, str | None]] = []

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

            # Project once and reuse — this same shape is needed again below when
            # the detection is kept and added to the in-scan dedup list.
            geom_m = project_to_utm(geom, scan_epsg)

            if reason is None:
                # Candidates come from two places: detections already in the DB
                # (indexed once in `tree`) and ones added earlier in this same
                # scan (`added`, normally a handful). Checking both avoids
                # rebuilding the spatial index on every insert.
                candidates = [existing[int(j)]["geom"] for j in tree.query(geom_m, predicate="intersects")] if tree is not None else []
                candidates.extend(g for g in added if g.intersects(geom_m))

                for other in candidates:
                    inter = geom_m.intersection(other).area
                    if inter > 0:
                        iou = inter / (geom_m.area + other.area - inter)
                        if iou >= dedup_threshold:
                            reason = "duplicate"
                            break
                    # Nested/offset masks over the same array can score a low IoU,
                    # so also treat "one contains the other's centre" as a dupe.
                    if other.contains(geom_m.representative_point()) or geom_m.contains(
                        other.representative_point()
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
            added.append(geom_m)
            created_events.append((det_id, None, status))

        record_events(
            con, created_events, action="created", actor=actor, reason=f"scan {scan_id}"
        )

    return {"scan_id": scan_id, "ids": ids, "counts": counts}


ACTION_FOR_STATUS = {"confirmed": "confirm", "rejected": "reject", "pending": "restore"}


def record_events(
    con: sqlite3.Connection,
    rows: list[tuple[int, str | None, str | None]],
    *,
    action: str,
    actor: str = DEFAULT_ACTOR,
    reason: str | None = None,
) -> None:
    """Append audit rows for (detection_id, from_status, to_status) tuples.

    Append-only by contract: nothing in this module updates or deletes from
    detection_event. Callers pass the *previous* status because once the UPDATE
    has run it is no longer recoverable from the table.
    """
    if not rows:
        return
    con.executemany(
        "INSERT INTO detection_event(detection_id, actor, action, from_status, to_status, reason)"
        " VALUES (?,?,?,?,?,?)",
        [(det_id, actor, action, before, after, reason) for det_id, before, after in rows],
    )


def set_status(
    con: sqlite3.Connection,
    det_id: int,
    status: str,
    *,
    actor: str = DEFAULT_ACTOR,
    reason: str | None = None,
) -> dict:
    row = con.execute("SELECT review_status FROM detection WHERE id=?", (det_id,)).fetchone()
    if row is None:
        raise KeyError(det_id)
    previous = row["review_status"]
    reviewed = "datetime('now')" if status in ("confirmed", "rejected") else "NULL"
    with con:
        con.execute(
            f"UPDATE detection SET review_status=?, reviewed_at={reviewed},"
            " filter_reason=CASE WHEN ?='pending' THEN NULL ELSE filter_reason END"
            " WHERE id=?",
            (status, status, det_id),
        )
        record_events(
            con,
            [(det_id, previous, status)],
            action=ACTION_FOR_STATUS.get(status, "set_status"),
            actor=actor,
            reason=reason,
        )
    return {"id": det_id, "status": status, "previous": previous}


def set_status_batch(
    con: sqlite3.Connection,
    det_ids: list[int],
    status: str,
    *,
    actor: str = DEFAULT_ACTOR,
    reason: str | None = None,
    action: str | None = None,
) -> int:
    if not det_ids:
        return 0
    reviewed = "datetime('now')" if status in ("confirmed", "rejected") else "NULL"
    q = ",".join("?" * len(det_ids))
    # Read the old statuses before the UPDATE overwrites them — the audit row is
    # only worth having if it records what the value actually changed from.
    previous = {
        r["id"]: r["review_status"]
        for r in con.execute(
            f"SELECT id, review_status FROM detection WHERE id IN ({q})", det_ids
        )
    }
    with con:
        cur = con.execute(
            f"UPDATE detection SET review_status=?, reviewed_at={reviewed} WHERE id IN ({q})",
            [status, *det_ids],
        )
        record_events(
            con,
            [(i, previous.get(i), status) for i in det_ids if i in previous],
            action=action or ACTION_FOR_STATUS.get(status, "set_status"),
            actor=actor,
            reason=reason,
        )
    return cur.rowcount


def live_rows_in_bbox(
    con: sqlite3.Connection,
    bbox: tuple[float, float, float, float],
    columns: str = "id, lng, lat",
) -> list[sqlite3.Row]:
    """Pending/confirmed detections whose centroid falls in [west, south, east, north].

    Goes through the detection_bbox R-tree rather than range-scanning the
    (lng, lat) index, so both dimensions narrow before any detection row is
    read. Rejected rows are excluded here because every caller — dedup and
    erase alike — treats them as eligible for re-detection.
    """
    west, south, east, north = bbox
    return con.execute(
        f"SELECT d.{columns.replace(', ', ', d.')} FROM detection_bbox b"
        " JOIN detection d ON d.id = b.id"
        " WHERE b.max_lng >= ? AND b.min_lng <= ?"
        "   AND b.max_lat >= ? AND b.min_lat <= ?"
        "   AND d.review_status IN ('pending','confirmed')",
        (west, east, south, north),
    ).fetchall()


def ids_in_circle(con: sqlite3.Connection, center: tuple[float, float], radius_m: float) -> list[int]:
    """Ids of live (pending or confirmed) detections centred inside a circle.

    Split out from erase_in_circle so the map agent can tell the user what an
    erase would remove before running it.
    """
    if radius_m <= 0:
        raise ValueError("radius_m must be positive")
    clat, clng = center
    import math

    m_per_deg_lat = 111_320.0
    m_per_deg_lng = 111_320.0 * math.cos(math.radians(clat))
    pad = 1.15
    dlat = (radius_m * pad) / m_per_deg_lat
    dlng = (radius_m * pad) / m_per_deg_lng
    rows = live_rows_in_bbox(
        con, (clng - dlng, clat - dlat, clng + dlng, clat + dlat)
    )

    epsg = utm_epsg_for(clng, clat)
    from solar_geometry import project_to_utm

    center_m = project_to_utm(Point(clng, clat), epsg)
    # Straight-line distance, not a bounding box: the UI draws a circle of this
    # radius, and a square's corners reach radius*sqrt(2) — erasing by box would
    # silently delete detections up to ~41% further out than the user selected.
    return [
        int(r["id"])
        for r in rows
        if center_m.distance(project_to_utm(Point(r["lng"], r["lat"]), epsg)) <= radius_m
    ]


def erase_in_circle(
    con: sqlite3.Connection,
    center: tuple[float, float],
    radius_m: float,
    *,
    actor: str = DEFAULT_ACTOR,
) -> dict:
    erase_ids = ids_in_circle(con, center, radius_m)
    if erase_ids:
        set_status_batch(
            con,
            erase_ids,
            "rejected",
            actor=actor,
            action="erase",
            reason=f"erased within {radius_m:.0f}m of {center[0]:.5f},{center[1]:.5f}",
        )
    return {"erased": len(erase_ids), "ids": erase_ids}


def merge_detections(
    con: sqlite3.Connection, det_ids: list[int], *, actor: str = DEFAULT_ACTOR
) -> dict:
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
        # Both sides of the merge are recorded: the survivor absorbed geometry,
        # and the others were rejected *because of* this merge — without the
        # reason they would look like ordinary rejections in the audit.
        record_events(
            con,
            [(primary_id, status, status)],
            action="merge",
            actor=actor,
            reason=f"absorbed {rejected}" if rejected else "merge",
        )
        record_events(
            con,
            [(i, status, "rejected") for i in rejected],
            action="merge",
            actor=actor,
            reason=f"merged into {primary_id}",
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
    actor: str = DEFAULT_ACTOR,
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
        record_events(
            con, [(det_id, None, status)], action="created", actor=actor, reason="manual"
        )
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


def _compute_coverage(con: sqlite3.Connection) -> dict:
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


def coverage(con: sqlite3.Connection, *, use_cache: bool = True) -> dict:
    """Unioned scanned area, memoised in coverage_cache.

    The union has to be recomputed from scratch whenever the scan set changes —
    overlapping squares mean the total is not the sum of the parts — but it does
    not change in between, and stats() asks for it on every page load, after
    every scan and on each agent turn. The cache key is (scan count, max scan
    id): an insert moves max_scan_id and a delete moves scan_count, so no stale
    row can pass as current.
    """
    tally = con.execute(
        "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS max_id FROM scanned_area"
    ).fetchone()
    scan_count, max_scan_id = tally["n"], tally["max_id"]

    if use_cache:
        cached = con.execute(
            "SELECT scanned_area_km2, geometry FROM coverage_cache"
            " WHERE id = 1 AND scan_count = ? AND max_scan_id = ?",
            (scan_count, max_scan_id),
        ).fetchone()
        if cached is not None:
            return {
                "scanned": shape(json.loads(cached["geometry"])) if cached["geometry"] else None,
                "scanned_area_km2": cached["scanned_area_km2"],
            }

    result = _compute_coverage(con)
    try:
        with con:
            con.execute(
                "INSERT INTO coverage_cache(id, scan_count, max_scan_id, scanned_area_km2,"
                " geometry, updated_at) VALUES (1,?,?,?,?,datetime('now'))"
                " ON CONFLICT(id) DO UPDATE SET"
                "   scan_count = excluded.scan_count,"
                "   max_scan_id = excluded.max_scan_id,"
                "   scanned_area_km2 = excluded.scanned_area_km2,"
                "   geometry = excluded.geometry,"
                "   updated_at = excluded.updated_at",
                (
                    scan_count,
                    max_scan_id,
                    result["scanned_area_km2"],
                    json.dumps(mapping(result["scanned"])) if result["scanned"] else None,
                ),
            )
    except sqlite3.Error:
        # A read-only or locked database should still be able to report coverage.
        pass
    return result


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
