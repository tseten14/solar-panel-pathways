-- Baseline: the two tables the store started with.
--
-- Every statement is IF NOT EXISTS so this applies cleanly to a database that
-- already has these tables from the pre-migrations era, where schema.sql was
-- re-executed on every connection.

CREATE TABLE IF NOT EXISTS scanned_area (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    geometry        TEXT NOT NULL,       -- GeoJSON polygon, WGS84
    model           TEXT NOT NULL,       -- sam3 | yolo
    center_lat      REAL,
    center_lng      REAL,
    radius_m        REAL,
    utm_epsg        INTEGER,             -- resolved UTM zone for this scan
    scanned_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS detection (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    geometry        TEXT NOT NULL,       -- GeoJSON polygon, WGS84
    lng             REAL NOT NULL,
    lat             REAL NOT NULL,
    model           TEXT NOT NULL,       -- sam3 | yolo | paint
    confidence      REAL,
    area_m2         REAL,
    compactness     REAL,                -- Polsby-Popper
    rectangularity  REAL,                -- area / min-rotated-rect area
    aspect_ratio    REAL,                -- bbox long/short side
    scan_id         INTEGER REFERENCES scanned_area(id),
    review_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending','confirmed','rejected')),
    filter_reason   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    reviewed_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_detection_status ON detection(review_status);
CREATE INDEX IF NOT EXISTS idx_detection_scan   ON detection(scan_id);
CREATE INDEX IF NOT EXISTS idx_detection_lnglat ON detection(lng, lat);
