-- Append-only audit trail, mirroring the CV-footprints review store.
--
-- The detection table holds only the *current* status, so "who rejected this,
-- and why?" was previously unanswerable. Detection geometry is re-runnable;
-- human decisions are not, which is exactly what makes them worth recording.
--
-- Rows are never updated or deleted. `actor` is the reviewer id from the
-- X-Reviewer header, or "agent" when the AI panel made the change.

CREATE TABLE IF NOT EXISTS detection_event (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    detection_id  INTEGER NOT NULL REFERENCES detection(id),
    actor         TEXT NOT NULL DEFAULT 'unknown',
    action        TEXT NOT NULL,  -- created | confirm | reject | restore | merge | erase
    from_status   TEXT,
    to_status     TEXT,
    reason        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detection_event_det  ON detection_event(detection_id);
CREATE INDEX IF NOT EXISTS idx_detection_event_time ON detection_event(created_at);
CREATE INDEX IF NOT EXISTS idx_detection_event_actor ON detection_event(actor);
