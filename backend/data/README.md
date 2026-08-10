# Solar scan store

SQLite database behind the Solar Detections page: what was scanned, what SAM 3
found, and every human or agent decision made about it.

Detection is re-runnable — you can always scan an area again. Review decisions
are not, so they are the part worth protecting, which is what the audit trail
and the integrity views are for.

## Engine

SQLite (`solar_scans.db`, WAL mode). Schema is applied by numbered migrations in
[`migrations/`](migrations), tracked in `schema_migrations` and run once per
process from `solar_store.connect()` — see [`../solar_migrate.py`](../solar_migrate.py).

There is no `schema.sql`. It was removed when migrations landed: it had been
re-executed on every single connection, and having two sources of DDL truth is
how they drift apart.

## Tables and views

| Object | Purpose |
|--------|---------|
| `detection` | **Source of truth** — one row per detected array, with `review_status` |
| `scanned_area` | One row per scan, with its coverage polygon |
| `detection_event` | **Append-only audit** — actor, action, from→to status, reason |
| `detection_bbox` | R-tree over detection centroids, kept current by triggers |
| `coverage_cache` | Memoised union of `scanned_area`, keyed on (count, max id) |
| `schema_migrations` | Which migrations this database has had applied |
| `v_rejected_without_reason` | Rejections with no audit event behind them |
| `v_review_timestamp_drift` | `review_status` and `reviewed_at` disagreeing |
| `v_detection_unindexed` | Detections missing from the R-tree |
| `v_scan_summary` | Per-scan rollup of detections by status |
| `v_detection_latest_event` | Most recent decision per detection |

`GET /integrity` returns the count from each integrity view; all zero means
consistent.

## Adding a migration

Add `migrations/00N_what_it_does.sql` and restart the backend. Files apply in
filename order, at most once each, inside an `IMMEDIATE` transaction so two
processes starting together cannot both apply the same one.

Never edit a migration that has shipped — databases that already applied it will
not re-run it. Write a new one instead.

## Audit trail

Every write path (`persist_scan`, `set_status`, `set_status_batch`,
`erase_in_circle`, `merge_detections`, `insert_manual_detection`) records into
`detection_event`. Nothing updates or deletes from it.

`actor` comes from the `X-Reviewer` request header, or `agent` when the AI panel
made the change, or `unknown` when neither applies. `GET /detections/{id}/history`
returns the full history for one detection.

## Conventions

- Geometry is GeoJSON text in WGS84, with `lng`/`lat` holding the centroid.
- Areas are measured by projecting to the scan's UTM zone (`utm_epsg`), because
  a nationwide dataset has no single sensible projection.
- Coverage is absolute km² scanned, not a percentage — unlike the fixed-island
  reference project there is no denominator to divide by.
