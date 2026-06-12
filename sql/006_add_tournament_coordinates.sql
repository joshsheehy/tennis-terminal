-- Swings phase 1: nullable coordinates on tournaments, filled by the
-- geocoding backfill (src/scripts/geocode-tournaments.ts or
-- /api/geocode-tournaments). Additive only and safe on live data:
-- ADD COLUMN with no default is a catalog-only change in Postgres
-- (no table rewrite, takes only a brief ACCESS EXCLUSIVE lock).
alter table tournaments add column if not exists latitude double precision;
alter table tournaments add column if not exists longitude double precision;
