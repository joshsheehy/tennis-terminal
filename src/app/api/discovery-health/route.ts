import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

// Events with no cut to find and no fix a sync can apply, so counting them as
// coverage failures would make the gate unpassable for reasons unrelated to
// whether the pipeline is working.
//
// Cancelled tournaments (Durham, Centurion 3/4, Fujairah, etc.) do NOT belong
// in this set any more — they are handled one level down, in
// cancelled-editions.ts, which flips their status to 'not_held' in the
// database. checkRecentCutCoverage's query already filters on
// `te.status = 'held'`, so a cancelled edition simply stops being a row this
// query sees, the same as it stops being a row any other query sees. That is
// the more correct fix: the fact "this tournament didn't happen" lives once,
// next to the other facts about the tournament, instead of being repeated
// here as a guess inferred from an empty PDF.
//
// What's left here is the one category that status flip cannot cover: events
// that DID happen but have no ProTennisLive posting to begin with. The Slams
// use a different results pipeline entirely (/api/import-slam-cuts) and were
// never going to appear in a PTL-code-driven coverage count.
const NO_PTL_POSTING_SLUGS = new Set<string>([
  'us-open-new-york',
  'us-open-qualifying-new-york',
  'australian-open-melbourne',
  'australian-open-qualifying-melbourne',
  'roland-garros-paris',
  'roland-garros-qualifying-paris',
  'wimbledon-london',
  'wimbledon-qualifying-london',
]);

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
  // Official ATP Challenger calendar PDF — the live "new tournaments" feed.
  //
  // IMPORTANT: row count is NOT a reliable health signal for this source.
  // import-calendars (the static-catalogue sync that runs in the same job)
  // re-stamps every Challenger already in tournament-data.ts back to source
  // 'atp_challenger_pdf'. So only the challengers NOT in the hardcoded
  // catalogue — the genuinely-new discoveries — keep the
  // 'atp_official_calendar_pdf' source, typically a few dozen. The meaningful
  // signal is FRESHNESS: if live discovery breaks, those rows stop updating
  // and staleDays climbs. minRows is just a low floor to confirm the source
  // hasn't vanished entirely.
  { source: 'atp_official_calendar_pdf', label: 'Challenger calendar (official PDF)', minRows: 5, maxStaleDays: 4 },
  // ITF World Tennis Tour calendar API. Not in the catalogue, so its rows
  // keep their source and the row count IS a valid signal here.
  { source: 'itf_calendar_api', label: 'ITF calendar (itftennis.com API)', minRows: 20, maxStaleDays: 4 },
];

/**
 * Are cuts still landing for events that have already been played?
 *
 * Calendar freshness says discovery is alive; it says nothing about whether
 * the cut importer is doing its job. Both can diverge, and did: through
 * September 2026 the nightly sync ran green every night while roughly five
 * events a week finished and never received a cut, because the importer could
 * not resolve their ProTennisLive code. Coverage for the season fell to 61%
 * with nothing anywhere reporting a problem.
 *
 * An event is only counted once its week is comfortably over — a PDF posted
 * the day the draw is made is normal, a fortnight of silence is not.
 */
async function checkRecentCutCoverage(year: number) {
  const result = await pool.query<{ total: string; with_cut: string; slug: string }>(
    `
    select
      t.slug,
      1 as total,
      (exists (
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'singles'
          and cs.draw_type = 'main'
          and cs.last_direct_acceptance_rank is not null
      ))::int as with_cut
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'held'
      and te.level not ilike 'ITF%'
      and te.start_date is not null
      and te.start_date <= current_date - interval '14 days'
      and te.start_date >= current_date - interval '70 days'
    `,
    [year]
  );

  // Some events will never have a PTL-sourced cut, and counting them as
  // failures makes the alarm useless. A gate that can't reach its threshold
  // goes red every night for something no sync can fix, and then nobody reads
  // the emails.
  //
  // Cancelled editions are already gone from `result.rows` — the query above
  // filters on status='held', and cancelled-editions.ts is what keeps that
  // status current. What's left to exclude here is the Slams, which have no
  // ProTennisLive posting at all and were never going to show up any other
  // way. They stay visible in the response rather than being silently
  // dropped, on the off chance that ever changes.
  const excluded: string[] = [];
  const counted = result.rows.filter((row) => {
    const noPosting = NO_PTL_POSTING_SLUGS.has(row.slug);
    if (noPosting) excluded.push(row.slug);
    return !noPosting;
  });

  const total = counted.length;
  const withCut = counted.filter((row) => Number(row.with_cut) === 1).length;
  // Below this and something is systematically broken rather than a handful of
  // events whose PDFs were never published.
  const MIN_COVERAGE = 0.7;
  const coverage = total === 0 ? 1 : withCut / total;
  const problems =
    total > 0 && coverage < MIN_COVERAGE
      ? [
          `only ${withCut}/${total} events played in the last 10 weeks have a singles main cut ` +
            `(${(coverage * 100).toFixed(0)}%, expected ≥ ${MIN_COVERAGE * 100}%)`,
        ]
      : [];

  return {
    source: 'cut_import',
    label: 'Cut import (played events)',
    year,
    rowCount: total,
    withCut,
    // Events left out of the count because there is no ProTennisLive posting
    // to import from (the Slams). Cancelled editions do not appear here —
    // they are absent from rowCount/withCut too, having already dropped out
    // of the query above.
    excludedNoPosting: excluded.sort(),
    coveragePercent: Number((coverage * 100).toFixed(1)),
    lastUpdated: null,
    staleDays: null,
    healthy: problems.length === 0,
    problems,
  };
}

/**
 * Week-by-week view of the same question, for a human rather than the gate.
 *
 * The pass/fail check above collapses ten weeks into one percentage, which is
 * the right shape for a workflow step and the wrong shape for "is this week's
 * batch in yet?". This lists each of the last eight weeks with the events still
 * missing a singles main cut, so the answer is a glance rather than a query.
 *
 * Purely informational — it never contributes to `healthy`. The most recent
 * weeks legitimately show gaps while draws are still being made.
 */
async function weeklyCutCoverage(year: number) {
  const result = await pool.query<{
    week: number | null;
    start_date: Date | string | null;
    slug: string;
    level: string;
    has_cut: boolean;
  }>(
    `
    select te.week,
           min(te.start_date) as start_date,
           t.slug,
           te.level,
           exists (
             select 1 from cutoff_snapshots cs
             where cs.tournament_edition_id = te.id
               and cs.event_type = 'singles'
               and cs.draw_type = 'main'
               and cs.last_direct_acceptance_rank is not null
           ) as has_cut
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'held'
      and te.level not ilike 'ITF%'
      and te.start_date is not null
      and te.start_date <= current_date
      and te.start_date >= current_date - interval '56 days'
    group by te.id, te.week, t.slug, te.level
    order by te.week desc, t.slug
    `,
    [year]
  );

  const byWeek = new Map<number, { week: number; startDate: string | null; total: number; withCut: number; missing: string[] }>();
  for (const row of result.rows) {
    const week = row.week ?? 0;
    let bucket = byWeek.get(week);
    if (!bucket) {
      const iso = row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : row.start_date ?? null;
      bucket = { week, startDate: iso, total: 0, withCut: 0, missing: [] };
      byWeek.set(week, bucket);
    }
    bucket.total += 1;
    if (row.has_cut) bucket.withCut += 1;
    else bucket.missing.push(`${row.slug} (${row.level})`);
  }

  return Array.from(byWeek.values()).sort((a, b) => b.week - a.week);
}

/**
 * Editions the cancelled-editions.ts sweep has taken out of the 'held' pool
 * recently — the answer to "is that gap real or is the event just cancelled?"
 * without having to go read the source file. Purely informational: these rows
 * are already outside every coverage query by virtue of status='not_held', so
 * this list changes nothing about `healthy`.
 */
async function recentlyCancelled(year: number) {
  const result = await pool.query<{
    slug: string;
    name: string;
    level: string;
    week: number | null;
    start_date: Date | string | null;
    has_cuts: boolean;
  }>(
    `
    select t.slug, t.name, te.level, te.week, te.start_date,
           exists (
             select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id
           ) as has_cuts
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'not_held'
      and te.level not ilike 'ITF%'
      and te.start_date is not null
      and te.start_date >= current_date - interval '70 days'
      and te.start_date <= current_date + interval '14 days'
    order by te.start_date desc
    `,
    [year]
  );

  return result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    level: row.level,
    week: row.week,
    startDate: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : row.start_date,
    // A cancelled edition can still carry a real entry list published before
    // the call-off (Fujairah 1) — worth flagging rather than implying no data
    // survived.
    hasEntryListData: row.has_cuts,
  }));
}

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

  // Discovery finding tournaments is only half the pipeline; the other half is
  // cuts actually arriving for them.
  const [cutCoverage, recentWeeks, cancelledEditions] = await Promise.all([
    checkRecentCutCoverage(year),
    weeklyCutCoverage(year),
    recentlyCancelled(year),
  ]);
  const allChecks = [...sources, cutCoverage];
  const healthy = allChecks.every((s) => s.healthy);

  return NextResponse.json(
    {
      ok: true,
      healthy,
      year,
      checkedAt: new Date().toISOString(),
      sources: allChecks,
      // Informational, never gating: which events in each of the last eight
      // weeks are still waiting on a cut.
      recentWeeks,
      // Informational, never gating: events near the coverage window that
      // were cancelled rather than missing — see cancelled-editions.ts for
      // the official-calendar evidence behind each one.
      cancelledEditions,
      // Flat reason list so the workflow can echo what's wrong in one line.
      problems: allChecks.flatMap((s) => (s.healthy ? [] : [`${s.label}: ${s.problems.join('; ')}`])),
    },
    // 200 even when unhealthy: edge proxies rewrite 5xx bodies, and the caller
    // inspects the `healthy` boolean, not the HTTP status.
    { status: 200 }
  );
}
