-- R-tree over detection centroids.
--
-- Every spatial read (re-scan dedup, erase-in-circle, bbox queries) starts by
-- narrowing to detections near a point or box. The old composite index on
-- (lng, lat) can only range-scan lng and then filter lat row by row, which over
-- a nationwide dataset means reading far more rows than match. An R-tree does
-- the range in both dimensions at once.
--
-- Centroids, not polygon extents: the callers all filter on the centroid
-- columns, so indexing centroids keeps the results identical to before.
--
-- Triggers keep this in sync, so no Python write path has to remember to.

CREATE VIRTUAL TABLE IF NOT EXISTS detection_bbox USING rtree(
    id,               -- matches detection.id
    min_lng, max_lng,
    min_lat, max_lat
);

-- Backfill anything already stored.
INSERT OR REPLACE INTO detection_bbox(id, min_lng, max_lng, min_lat, max_lat)
SELECT id, lng, lng, lat, lat FROM detection;

CREATE TRIGGER IF NOT EXISTS detection_bbox_insert
AFTER INSERT ON detection
BEGIN
    INSERT OR REPLACE INTO detection_bbox(id, min_lng, max_lng, min_lat, max_lat)
    VALUES (new.id, new.lng, new.lng, new.lat, new.lat);
END;

-- Merging rewrites a detection's geometry and centroid, so the index has to move with it.
CREATE TRIGGER IF NOT EXISTS detection_bbox_update
AFTER UPDATE OF lng, lat ON detection
BEGIN
    UPDATE detection_bbox
       SET min_lng = new.lng, max_lng = new.lng,
           min_lat = new.lat, max_lat = new.lat
     WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS detection_bbox_delete
AFTER DELETE ON detection
BEGIN
    DELETE FROM detection_bbox WHERE id = old.id;
END;
