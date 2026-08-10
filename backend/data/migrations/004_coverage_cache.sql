-- Memo for the scanned-area union.
--
-- coverage() unions every scanned_area polygon and reprojects it to measure km².
-- stats() calls coverage(), and stats() is hit on every page load, after every
-- scan, and by each agent turn — so the cost of the whole scan history was
-- being paid over and over for a number that only changes when a scan lands.
--
-- Validity is keyed on (scan count, max scan id): any insert moves max_scan_id,
-- any delete moves scan_count, so a stale row can't be mistaken for a fresh one.

CREATE TABLE IF NOT EXISTS coverage_cache (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    scan_count        INTEGER NOT NULL,
    max_scan_id       INTEGER NOT NULL,
    scanned_area_km2  REAL NOT NULL,
    geometry          TEXT,              -- GeoJSON of the unioned coverage
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
