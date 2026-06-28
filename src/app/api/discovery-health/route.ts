import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Health signal for the autonomous tournament-discovery pipeline.
//
// Each discovery source upserts rows with updated_at = now() on EVERY
// successful run (even when the underlying calendar is unchanged), so the
// freshness of max(updated_at) per source is a direct proxy for "is the
// discovery cron still working?". If the official ATP Challenger calendar PDF
// stops being found, or the ITF API changes shape, the daily cron upserts
// nothing, max(updated_at) stops advancing, and staleDays climbs past the
// threshold — flipping healthy=false.
//
// The daily data-sync workflow hits this and exits non-zero when unhealthy,
// so a silently-broken scraper surfaces as a failed GitHub Action (which
// emails the repo owner) instead of quietly going stale. Also browsable by
// the operator: /api/discovery-health?key=...
//
// Thresholds are deliberately loose — the daily crons refresh updated_at once
// a day, so a few days of staleness means several consecutive failed runs.

type SourceCheck = {
  source: string;
  label: string;
  minRows: number;
  maxStaleDays: number;
};

const CHECKS: SourceCheck[] = [
  // Official ATP Challenger calendar PDF — the main "new tournaments" feed.
  { source: 'atp_official_calendar_pdf', label: 'Challenger calendar (official PDF)', minRows: 50, maxStaleDays: 4 },
  // ITF World Tennis Tour calendar API.
  { source: 'itf_calendar_api', label: 'ITF calendar (itftennis.com API)', minRows: 20, maxStaleDays: 4 },
];

export async function GET() {
  const year = new Date().getFullYear();

  const rows = await pool.query<{
    source: string;
    row_count: string;
    last_updated: string | null;
    stale_days: string | null;
  }>(
    `select te.source,
            count(*) as row_count,
            max(te.updated_at) as last_updated,
            extract(epoch from (now() - max(te.updated_at))) / 86400.0 as stale_days
     from tournament_editions te
     where te.year = $1
       and te.source = any($2::text[])
     group by te.source`,
    [year, CHECKS.map((c) => c.source)]
  );

  const bySource = new Map(rows.rows.map((r) => [r.source, r]));

  const sources = CHECKS.map((check) => {
    const row = bySource.get(check.source);
    const rowCount = row ? Number(row.row_count) : 0;
    const staleDays = row?.stale_days != null ? Number(row.stale_days) : null;
    const lastUpdated = row?.last_updated ?? null;

    const problems: string[] = [];
    if (rowCount < check.minRows) {
      problems.push(`only ${rowCount} rows for ${year} (expected ≥ ${check.minRows})`);
    }
    if (staleDays === null) {
      problems.push('no rows ever imported for this source/year');
    } else if (staleDays > check.maxStaleDays) {
      problems.push(`last refresh ${staleDays.toFixed(1)}d ago (expected ≤ ${check.maxStaleDays}d)`);
    }

    return {
      source: check.source,
      label: check.label,
      year,
      rowCount,
      lastUpdated,
      staleDays: staleDays === null ? null : Number(staleDays.toFixed(2)),
      healthy: problems.length === 0,
      problems,
    };
  });

  const healthy = sources.every((s) => s.healthy);

  return NextResponse.json(
    {
      ok: true,
      healthy,
      year,
      checkedAt: new Date().toISOString(),
      sources,
      // Flat reason list so the workflow can echo what's wrong in one line.
      problems: sources.flatMap((s) => (s.healthy ? [] : [`${s.label}: ${s.problems.join('; ')}`])),
    },
    // 200 even when unhealthy: edge proxies rewrite 5xx bodies, and the caller
    // inspects the `healthy` boolean, not the HTTP status.
    { status: 200 }
  );
}
