-- Read-only views that make bad states visible instead of silent.
--
-- Same intent as the CV-footprints store's integrity views: a review database
-- is only trustworthy if you can ask it what looks wrong.

-- Detections rejected with no audit event explaining it. Non-empty means
-- something rejected rows without going through the audited write path.
CREATE VIEW IF NOT EXISTS v_rejected_without_reason AS
SELECT d.id, d.lng, d.lat, d.model, d.reviewed_at
  FROM detection d
 WHERE d.review_status = 'rejected'
   AND NOT EXISTS (
       SELECT 1 FROM detection_event e
        WHERE e.detection_id = d.id AND e.to_status = 'rejected'
   );

-- Reviewed rows with no review timestamp (or the reverse) — the two should agree.
CREATE VIEW IF NOT EXISTS v_review_timestamp_drift AS
SELECT id, review_status, reviewed_at
  FROM detection
 WHERE (review_status IN ('confirmed','rejected') AND reviewed_at IS NULL)
    OR (review_status = 'pending' AND reviewed_at IS NOT NULL);

-- Detections whose centroid is missing from the R-tree, which would make them
-- invisible to dedup and erase.
CREATE VIEW IF NOT EXISTS v_detection_unindexed AS
SELECT d.id, d.lng, d.lat
  FROM detection d
 WHERE NOT EXISTS (SELECT 1 FROM detection_bbox b WHERE b.id = d.id);

-- Per-scan rollup: what each scan produced and how much of it survived review.
CREATE VIEW IF NOT EXISTS v_scan_summary AS
SELECT s.id                AS scan_id,
       s.model,
       s.scanned_at,
       s.radius_m,
       COUNT(d.id)                                                   AS detections,
       SUM(CASE WHEN d.review_status = 'pending'   THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN d.review_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN d.review_status = 'rejected'  THEN 1 ELSE 0 END) AS rejected
  FROM scanned_area s
  LEFT JOIN detection d ON d.scan_id = s.id
 GROUP BY s.id;

-- Most recent decision per detection, with who made it.
CREATE VIEW IF NOT EXISTS v_detection_latest_event AS
SELECT e.detection_id, e.actor, e.action, e.from_status, e.to_status,
       e.reason, e.created_at
  FROM detection_event e
  JOIN (
        SELECT detection_id, MAX(id) AS max_id
          FROM detection_event
         GROUP BY detection_id
       ) latest
    ON latest.max_id = e.id;
