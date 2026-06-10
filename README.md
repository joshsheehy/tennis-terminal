# Tennis Terminal

Tournament schedule and entry-cutoff data for the men's pro tour, served as a small Next.js + Postgres app.

## What it does

- Pulls the ATP Tour and Challenger calendars from official sources (atptour.com calendar PDFs, ATP archive pages, ProTennisLive postings, JeffSackmann's GitHub backup).
- Stores tournaments, editions, and per-draw cutoff snapshots in a three-table schema (`tournaments`, `tournament_editions`, `cutoff_snapshots`).
- Renders the schedule by week + the per-tournament history of cuts at `/` and `/tournaments/[slug]`.
- Runs a daily GitHub Actions sync to keep the data fresh, plus a weekly official-calendar refresh.

## Architecture (high level)

- **`src/app`** – Next.js app router pages and API routes.
- **`src/lib`** – shared helpers (db pool, ATP week math, PDF cutoff parser, canonical tournament catalogue).
- **`src/components`** – schedule UI (week picker, year picker, tournament card).
- **`sql/`** – schema and migration helpers.
- **`.github/workflows`** – the automated sync jobs.

## Local development

```bash
npm install
echo 'DATABASE_URL=postgres://...' > .env.local
npm run dev
```

## Deploy

- App + Postgres on Railway. Set `DATABASE_URL` and `APP_URL` (your Railway URL) as GitHub Actions secrets so the sync workflows can call back into the deployed API.
- Run the SQL in `sql/schema.sql` once on the database.

### API authentication

Every `/api/*` route except `/api/status` requires an admin secret (they can
all read or mutate the production database). Setup:

1. Generate a long random value (e.g. `openssl rand -hex 32`).
2. Set it as the `ADMIN_SECRET` environment variable on Railway.
3. Set the same value as the `ADMIN_SECRET` GitHub Actions secret so the sync
   workflows keep working.

Authenticate calls any of three ways:

- `X-Admin-Secret: <secret>` header (used by the workflows)
- `Authorization: Bearer <secret>` header (for cron schedulers)
- `?key=<secret>` query parameter (for manual calls from a browser)

Until `ADMIN_SECRET` (or legacy `CRON_SECRET`) is set in production, admin
routes return 503 — the API fails closed. Local `next dev` skips the check.

## Sync workflows

- `data-sync.yml` – daily 08:15 UTC. Pulls calendars, dedupes, refills cuts.
- `official-calendar-sync.yml` – weekly Monday 07:45 UTC. Re-parses the official ATP calendar PDF in case new tournaments were announced.

## Key API endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/sync-official-calendar?year=YYYY` | Import the official ATP Tour calendar PDF for the given season. |
| `/api/import-calendars` | Refresh the canonical hardcoded calendar. |
| `/api/import-challenger-season?year=YYYY` | Backfill challenger schedules from JeffSackmann (fallback source). |
| `/api/import-cutoffs?year=YYYY` | Pull cutoff PDFs from ProTennisLive for known codes. |
| `/api/run-all?force=true` | Sweep remaining missing cuts within a per-call time budget. |
| `/api/missing-cuts-report?year=YYYY&compact=true` | Snapshot of what's still missing, with confidence levels. |
| `/api/dedupe-by-code?apply=true` | Merge duplicate tournaments that share a ProTennisLive code. |
| `/api/cleanup-bad-cuts?apply=true` | Delete cuts the parser mis-extracted from results sheets / prize money. |
| `/api/status` | JSON snapshot of cut coverage across all editions. |
