#!/usr/bin/env bash
# Idempotent local Postgres setup for development & tests.
#
# Starts the Debian "main" Postgres cluster, ensures a `tennis` database with
# the app schema + migrations applied, seeds sample data when empty, and writes
# a local .env with DATABASE_URL. Safe to run repeatedly (e.g. from a
# SessionStart hook). No production data is ever touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-5432}"
PGUSER_DB="postgres"
PGPASS="${DEV_DB_PASSWORD:-devpassword}"
DBNAME="${DEV_DB_NAME:-tennis}"
CONN="postgresql://${PGUSER_DB}:${PGPASS}@localhost:${PGPORT}/${DBNAME}"

run_pg() { sudo -u postgres "$@"; }

# 1. Start the cluster if it is not already online.
if command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
    echo "dev-db: starting Postgres cluster..."
    sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
    sleep 1
  fi
else
  echo "dev-db: Postgres tooling not found; skipping DB setup." >&2
  exit 0
fi

# 2. Ensure the postgres role has a known password and the database exists.
run_pg psql -p "$PGPORT" -c "ALTER USER ${PGUSER_DB} PASSWORD '${PGPASS}';" >/dev/null
if ! run_pg psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_database WHERE datname='${DBNAME}'" | grep -q 1; then
  echo "dev-db: creating database ${DBNAME}..."
  run_pg createdb -p "$PGPORT" "$DBNAME"
fi

# 3. Apply schema + migrations (all idempotent).
export PGPASSWORD="$PGPASS"
export PGOPTIONS='--client-min-messages=warning'
for f in \
  "$ROOT/sql/schema.sql" \
  "$ROOT/sql/002_add_alternate_entries_count.sql" \
  "$ROOT/sql/003_allow_not_held_editions.sql" \
  "$ROOT/sql/004_add_lucky_loser_count.sql" \
  "$ROOT/sql/006_add_tournament_coordinates.sql"; do
  [ -f "$f" ] && psql "$CONN" -q -f "$f" >/dev/null
done

# 4. Seed sample data only when the schedule is empty.
COUNT="$(psql "$CONN" -tAc "SELECT count(*) FROM tournament_editions" 2>/dev/null || echo 0)"
if [ "${COUNT:-0}" -eq 0 ]; then
  echo "dev-db: seeding sample tournaments..."
  psql "$CONN" -q -f "$ROOT/scripts/seed-dev-db.sql" >/dev/null
fi

# 5. Provide DATABASE_URL via .env (gitignored) if not already set.
if [ ! -f "$ROOT/.env" ] || ! grep -q '^DATABASE_URL=' "$ROOT/.env" 2>/dev/null; then
  echo "DATABASE_URL=${CONN}" >> "$ROOT/.env"
  echo "dev-db: wrote DATABASE_URL to .env"
fi

echo "dev-db: ready (${COUNT:-?} editions; DATABASE_URL=${CONN})"
