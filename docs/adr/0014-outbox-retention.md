# 0014. Outbox retention

- Status: accepted
- Date: 2026-10-10

## Context

The relay marks outbox rows as published (`publishedAt`) but nothing deleted them, so `outbox_events`
grew with every payment (two rows per payment, three when it goes to the dead-letter topic, a few
hundred bytes each). At lab rates that is harmless, but a table that only grows is a trap the first time
someone runs the pattern for real, and the README promised no limit either way.

## Decision

- A daily job (`OutboxCleanupService`, scheduled like the refresh-token cleanup) deletes rows whose
  `publishedAt` is older than `OUTBOX_RETENTION_DAYS`. Defaults: 14 days, `OUTBOX_CLEANUP_CRON=0 4 * * *`.
  `OUTBOX_RETENTION_DAYS=0` switches it off.
- 14 days is on by default because published rows are only history: consumers read from Kafka, not from
  this table. It is long enough to inspect yesterday's failure, short enough to keep the table small, and
  it matches the refresh-token retention already in the repo.
- Deletion runs in batches of 1000 (`DELETE ... WHERE id IN (SELECT ... LIMIT 1000 FOR UPDATE SKIP
LOCKED)`) until a batch comes back short, so no statement holds locks for long and several replicas
  can run it at once without clashing.
- The condition is `publishedAt < cutoff`, which is never true for NULL: unpublished rows are never
  deleted, however old. A stuck relay or a Kafka outage cannot lose events through this job.
- The counter `outbox_deleted_total` (no labels) and one log line per run report what was removed.

## Consequences

- The table stays proportional to the retention window, not to all history.
- The relay query (`publishedAt IS NULL ORDER BY id LIMIT 50`) was already cheap, because unpublished
  rows are a small tail of the `(publishedAt, id)` index. The cost of published rows was table and index
  bloat and a longer vacuum; the job removes it. Deleting leaves dead tuples that autovacuum reclaims.
- The `publishedAt < cutoff` lookup uses the same index as a range scan, so no new index or migration.
- Audit history of events lives in Kafka (and its retention), not here. Anyone who needs a longer
  database history sets a larger `OUTBOX_RETENTION_DAYS` or archives before the job runs; partitioning
  by date and dropping old partitions is the heavier alternative and is not done here.
- The job runs in every API instance; `SKIP LOCKED` keeps instances from fighting over rows.
