"""Tests for the migration ledger, audit trail, spatial index and coverage memo."""

import json
import math

import pytest

import solar_migrate
import solar_store


@pytest.fixture
def db(tmp_path, monkeypatch):
    """A migrated, empty database on disk, isolated from the real one."""
    monkeypatch.setattr(solar_store, "DB_PATH", tmp_path / "test.db")
    solar_store.reset_schema_cache()
    con = solar_store.connect()
    yield con
    con.close()
    solar_store.reset_schema_cache()


def square(lng: float, lat: float, size: float = 0.0005) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [lng, lat], [lng + size, lat], [lng + size, lat + size],
            [lng, lat + size], [lng, lat],
        ]],
    }


def add_detection(con, lng, lat, *, status="pending", actor="tester"):
    return solar_store.insert_manual_detection(
        con, square(lng, lat), status=status, actor=actor
    )["properties"]["id"]


def events_for(con, det_id):
    return [
        dict(r)
        for r in con.execute(
            "SELECT actor, action, from_status, to_status, reason FROM detection_event"
            " WHERE detection_id = ? ORDER BY id",
            (det_id,),
        )
    ]


# --- migrations ---------------------------------------------------------------

def test_every_migration_is_applied_and_recorded(db):
    recorded = {r["version"] for r in db.execute("SELECT version FROM schema_migrations")}
    assert recorded == {p.stem for p in solar_migrate.available_migrations()}
    assert solar_migrate.pending_migrations(db) == []


def test_migrate_is_idempotent(db):
    assert solar_migrate.migrate(db) == []


def test_migrations_are_uniquely_numbered():
    stems = [p.stem for p in solar_migrate.available_migrations()]
    prefixes = [s.split("_", 1)[0] for s in stems]
    assert len(prefixes) == len(set(prefixes)), f"duplicate migration number in {stems}"


def test_baseline_migration_is_safe_on_an_existing_database(tmp_path, monkeypatch):
    """001 must no-op against a pre-migrations database that already has the tables."""
    monkeypatch.setattr(solar_store, "DB_PATH", tmp_path / "legacy.db")
    solar_store.reset_schema_cache()

    import sqlite3

    legacy = sqlite3.connect(tmp_path / "legacy.db")
    legacy.executescript(
        (solar_migrate.MIGRATIONS_DIR / "001_initial.sql").read_text()
    )
    legacy.execute(
        "INSERT INTO detection(geometry, lng, lat, model, review_status)"
        " VALUES (?, 1.0, 2.0, 'sam3', 'pending')",
        (json.dumps(square(1.0, 2.0)),),
    )
    legacy.commit()
    legacy.close()

    con = solar_store.connect()
    try:
        assert con.execute("SELECT COUNT(*) n FROM detection").fetchone()["n"] == 1
        # The R-tree backfill in 003 has to pick up the row that predates it.
        assert con.execute("SELECT COUNT(*) n FROM detection_bbox").fetchone()["n"] == 1
    finally:
        con.close()
        solar_store.reset_schema_cache()


# --- audit trail --------------------------------------------------------------

def test_manual_insert_records_a_created_event(db):
    det_id = add_detection(db, -119.0, 35.4, actor="alice")
    assert events_for(db, det_id) == [
        {"actor": "alice", "action": "created", "from_status": None,
         "to_status": "pending", "reason": "manual"}
    ]


def test_set_status_records_the_previous_status(db):
    det_id = add_detection(db, -119.0, 35.4)
    solar_store.set_status(db, det_id, "confirmed", actor="bob", reason="looks right")

    latest = events_for(db, det_id)[-1]
    assert latest == {
        "actor": "bob", "action": "confirm", "from_status": "pending",
        "to_status": "confirmed", "reason": "looks right",
    }


def test_batch_status_records_each_detections_own_previous_status(db):
    confirmed = add_detection(db, -119.0, 35.4, status="confirmed")
    pending = add_detection(db, -119.001, 35.4, status="pending")

    solar_store.set_status_batch(db, [confirmed, pending], "rejected", actor="carol")

    assert events_for(db, confirmed)[-1]["from_status"] == "confirmed"
    assert events_for(db, pending)[-1]["from_status"] == "pending"


def test_erase_is_audited_as_an_erase_not_a_plain_reject(db):
    det_id = add_detection(db, -119.0, 35.4)
    solar_store.erase_in_circle(db, (35.4, -119.0), 200, actor="dave")

    latest = events_for(db, det_id)[-1]
    assert latest["action"] == "erase"
    assert latest["to_status"] == "rejected"
    assert "200m" in latest["reason"]


def test_merge_audits_both_the_survivor_and_the_absorbed(db):
    a = add_detection(db, -119.0, 35.4)
    b = add_detection(db, -119.0 + 0.0002, 35.4)  # overlaps a

    result = solar_store.merge_detections(db, [a, b], actor="erin")
    survivor, absorbed = result["merged_id"], result["rejected_ids"][0]

    assert events_for(db, survivor)[-1]["action"] == "merge"
    absorbed_event = events_for(db, absorbed)[-1]
    assert absorbed_event["to_status"] == "rejected"
    assert str(survivor) in absorbed_event["reason"]


def test_audit_survives_the_detection_being_rejected(db):
    """Rejection must not erase history — that is the whole point of the table."""
    det_id = add_detection(db, -119.0, 35.4)
    solar_store.set_status(db, det_id, "rejected", actor="frank")
    solar_store.set_status(db, det_id, "pending", actor="frank")

    actions = [e["action"] for e in events_for(db, det_id)]
    assert actions == ["created", "reject", "restore"]


# --- spatial index ------------------------------------------------------------

def test_rtree_tracks_inserts(db):
    det_id = add_detection(db, -119.0, 35.4)
    row = db.execute("SELECT min_lng, min_lat FROM detection_bbox WHERE id=?", (det_id,)).fetchone()
    assert row is not None
    assert row["min_lng"] == pytest.approx(-119.0, abs=1e-3)


def test_rtree_follows_a_merged_geometry(db):
    """Merging rewrites the centroid; a stale index entry would hide the row."""
    a = add_detection(db, -119.0, 35.4)
    b = add_detection(db, -119.0 + 0.0002, 35.4)
    survivor = solar_store.merge_detections(db, [a, b])["merged_id"]

    stored = db.execute("SELECT lng, lat FROM detection WHERE id=?", (survivor,)).fetchone()
    indexed = db.execute("SELECT min_lng, min_lat FROM detection_bbox WHERE id=?", (survivor,)).fetchone()
    assert indexed["min_lng"] == pytest.approx(stored["lng"])
    assert indexed["min_lat"] == pytest.approx(stored["lat"])


def test_ids_in_circle_matches_a_brute_force_distance_check(db):
    """The index may only change how rows are found, never which rows are found."""
    points = [(-119.0, 35.4), (-119.002, 35.4), (-119.02, 35.4), (-119.0, 35.41)]
    ids = [add_detection(db, lng, lat) for lng, lat in points]

    center_lat, center_lng, radius_m = 35.4, -119.0, 300.0
    found = set(solar_store.ids_in_circle(db, (center_lat, center_lng), radius_m))

    expected = set()
    for det_id, (lng, lat) in zip(ids, points):
        dx = (lng - center_lng) * 111_320.0 * math.cos(math.radians(center_lat))
        dy = (lat - center_lat) * 111_320.0
        if math.hypot(dx, dy) <= radius_m:
            expected.add(det_id)

    assert found == expected


def test_ids_in_circle_ignores_rejected_detections(db):
    det_id = add_detection(db, -119.0, 35.4, status="pending")
    solar_store.set_status(db, det_id, "rejected")
    assert solar_store.ids_in_circle(db, (35.4, -119.0), 500) == []


def test_ids_in_circle_rejects_a_non_positive_radius(db):
    with pytest.raises(ValueError):
        solar_store.ids_in_circle(db, (35.4, -119.0), 0)


# --- coverage memo ------------------------------------------------------------

def _persist_scan(con, bbox):
    return solar_store.persist_scan(
        con, model="sam3", bbox=bbox, center=None, radius_m=None, features=[]
    )


def test_coverage_is_zero_with_no_scans(db):
    assert solar_store.coverage(db)["scanned_area_km2"] == 0.0


def test_coverage_cache_returns_the_same_area_as_a_fresh_computation(db):
    _persist_scan(db, (-119.01, 35.39, -119.0, 35.4))

    uncached = solar_store.coverage(db, use_cache=False)["scanned_area_km2"]
    cached = solar_store.coverage(db)["scanned_area_km2"]
    assert cached == pytest.approx(uncached)

    stored = db.execute("SELECT scan_count, max_scan_id FROM coverage_cache WHERE id=1").fetchone()
    assert stored["scan_count"] == 1


def test_coverage_cache_invalidates_when_a_scan_is_added(db):
    _persist_scan(db, (-119.01, 35.39, -119.0, 35.4))
    first = solar_store.coverage(db)["scanned_area_km2"]

    # A disjoint square, so the union must grow.
    _persist_scan(db, (-118.0, 35.39, -117.99, 35.4))
    second = solar_store.coverage(db)["scanned_area_km2"]

    assert second > first
    assert second == pytest.approx(solar_store.coverage(db, use_cache=False)["scanned_area_km2"])


def test_overlapping_scans_are_not_double_counted(db):
    _persist_scan(db, (-119.01, 35.39, -119.0, 35.4))
    one = solar_store.coverage(db)["scanned_area_km2"]
    _persist_scan(db, (-119.01, 35.39, -119.0, 35.4))  # identical square
    two = solar_store.coverage(db)["scanned_area_km2"]

    assert two == pytest.approx(one), "union area must ignore the overlap"


# --- integrity views ----------------------------------------------------------

def test_healthy_database_trips_no_integrity_view(db):
    det_id = add_detection(db, -119.0, 35.4)
    solar_store.set_status(db, det_id, "confirmed")

    for view in ("v_rejected_without_reason", "v_review_timestamp_drift", "v_detection_unindexed"):
        count = db.execute(f"SELECT COUNT(*) n FROM {view}").fetchone()["n"]
        assert count == 0, f"{view} flagged a healthy database"


def test_unaudited_rejection_is_flagged(db):
    """An UPDATE that bypasses the audited write path should be visible."""
    det_id = add_detection(db, -119.0, 35.4)
    db.execute(
        "UPDATE detection SET review_status='rejected', reviewed_at=datetime('now') WHERE id=?",
        (det_id,),
    )
    db.commit()

    flagged = [r["id"] for r in db.execute("SELECT id FROM v_rejected_without_reason")]
    assert flagged == [det_id]
