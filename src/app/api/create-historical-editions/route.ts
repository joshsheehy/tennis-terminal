import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Materializes historical (2024/2025) tournament editions for ATP Tour events so
// the bulk filler (/api/run-all) has rows to fill. The static catalogue holds the
// 2026 calendar; ATP ProTennisLive codes are stable across years (e.g. Stuttgart
// = 321 in both 2024 and 2026), so we can clone the 2026 entry to a prior year,
// shifting the dates, and let run-all pull that year's draw sheet from Wayback.
//
// Challenger codes are NOT reliably stable year to year, so this is ATP-only by
// default to avoid attaching the wrong draw to a tournament. Pass level=all to
// override (not recommended for historical Challengers).
//
// Usage:
//   GET /api/create-historical-editions?year=2024            (dry-run)
//   GET /api/create-historical-editions?year=2024&apply=true (create rows)
//
// Idempotent: existing editions are left untouched (on conflict do nothing).

const ATP_LEVELS = new Set(['ATP 250', 'ATP 500', 'ATP 1000']);

function shiftDateToYear(rawDate: string | null, year: number): string | null {
  if (!rawDate) return null;
  const parts = rawDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [, month, day] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get('year'));
  const apply = sp.get('apply') === 'true';
  const levelFilter = sp.get('level') ?? 'atp';

  if (![2024, 2025].includes(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024 or 2025' }, { status: 400 });
  }

  // One template entry per slug: the most recent coded edition (the 2026 calendar row).
  const templateBySlug = new Map<string, (typeof ALL_EDITIONS)[number]>();
  for (const entry of ALL_EDITIONS) {
    if (!entry.edition.protennislive_code) continue;
    if (levelFilter === 'atp' && !ATP_LEVELS.has(entry.edition.level)) continue;
    const existing = templateBySlug.get(entry.tournament.slug);
    if (!existing || entry.edition.year > existing.edition.year) {
      templateBySlug.set(entry.tournament.slug, entry);
    }
  }

  const created: Array<{ slug: string; year: number; start_date: string | null; code: string | null }> = [];
  const alreadyExisted: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  for (const entry of templateBySlug.values()) {
    const { tournament, edition } = entry;
    try {
      const tourResult = await pool.query<{ id: string }>(
        `insert into tournaments (slug, name, city, country, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (slug) do update set updated_at = tournaments.updated_at
         returning id`,
        [tournament.slug, tournament.name, tournament.city, tournament.country]
      );
      const tournamentId = tourResult.rows[0].id;

      const existing = await pool.query<{ id: string }>(
        `select id from tournament_editions where tournament_id = $1 and year = $2 limit 1`,
        [tournamentId, year]
      );
      if (existing.rows.length) {
        alreadyExisted.push(tournament.slug);
        continue;
      }

      const startDate = shiftDateToYear(edition.start_date, year);
      const endDate = shiftDateToYear(edition.end_date, year);

      if (apply) {
        await pool.query(
          `insert into tournament_editions (
             tournament_id, year, week, start_date, end_date, level, surface, indoor,
             source, source_url, status, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', now())
           on conflict (tournament_id, year) do nothing`,
          [
            tournamentId,
            year,
            edition.week,
            startDate,
            endDate,
            edition.level,
            edition.surface,
            edition.indoor,
            edition.source,
            // Seed the source_url with this year's PTL posting path so the filler
            // and code-extraction regexes resolve the stable code immediately.
            `https://www.protennislive.com/posting/${year}/${edition.protennislive_code}/`,
          ]
        );
      }

      created.push({
        slug: tournament.slug,
        year,
        start_date: startDate,
        code: edition.protennislive_code,
      });
    } catch (err) {
      failed.push({ slug: tournament.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Recompute week from the shifted start_date so the new rows land in the right week.
  if (apply) {
    await pool.query(
      `update tournament_editions te
       set week = greatest(1, (te.start_date::date - date_trunc('week', make_date(te.year, 1, 1))::date) / 7 + 1),
           updated_at = now()
       where te.year = $1 and te.start_date is not null`,
      [year]
    );
  }

  return NextResponse.json({
    ok: failed.length === 0,
    dryRun: !apply,
    year,
    levelFilter,
    candidateCount: templateBySlug.size,
    createdCount: created.length,
    alreadyExistedCount: alreadyExisted.length,
    failedCount: failed.length,
    created,
    alreadyExisted,
    failed,
    note: apply
      ? `Created ${created.length} ${year} editions. Now call /api/run-all repeatedly until hasMore:false to fill cuts from Wayback.`
      : `Dry-run: ${created.length} ${year} editions would be created. Re-run with &apply=true.`,
  });
}
