#!/bin/bash
# SessionStart hook for Claude Code on the web: install dependencies and bring
# up a local Postgres so tests and the app can run without external services.
# Idempotent and non-interactive.
set -euo pipefail

# Web-only; no-op for local CLI sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 1. Node dependencies (npm install benefits from container caching).
npm install

# 2. Local Postgres: cluster, schema + migrations, sample seed data, and a
#    gitignored .env carrying DATABASE_URL.
bash scripts/dev-db.sh

# 3. Surface DATABASE_URL to the rest of the session's shell environment.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -f .env ]; then
  grep '^DATABASE_URL=' .env | sed 's/^/export /' >> "$CLAUDE_ENV_FILE"
fi
