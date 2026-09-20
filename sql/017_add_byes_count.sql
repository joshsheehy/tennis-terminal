-- Empty slots (byes) reported by a draw sheet's Last Direct Acceptance box.
-- A draw that is not full has no last direct acceptance, so the sheet prints
-- "Byes (N)" there instead of a player. Storing N here keeps it from being read
-- as a cut, and shows how many places were open. Null = the sheet reported no byes.
-- Additive and safe on live data: ADD COLUMN with no default is a catalog-only
-- change. The app also applies this on first use (ensureByesColumn in src/lib/db.ts),
-- so deploying the code before running this file cannot break the site.
alter table cutoff_snapshots add column if not exists byes_count int;
