-- Byes in the ITF qualifying draw, stored on the singles-qualifying
-- cutoff_snapshots row. Populated by /api/import-itf-cutoffs from the official
-- ITF strength sheet. Null for ATP/Challenger rows (they don't carry byes).
alter table cutoff_snapshots
  add column if not exists qualifying_byes_count int;
