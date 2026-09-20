import { NextRequest, NextResponse } from 'next/server';
import { pool, ensureByesColumn } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which events missing a cut could get their ProTennisLive code for free?
 *
 * A code belongs to the tournament and never changes — Szczecin is 448 every
 * season — so an event that has run before does not need discovery at all. Its
 * code is already somewhere in the database, and /api/import-cutoffs recovers
 * it by regex over the last five seasons.
 *
 * That recovery joins on slug, though, and slugs are not stable: the calendar
 * importer names this year's event `phan-thiet-3` while the catalogue has
 * `phan-thiet-1-phan-thiet`, and a renamed or renumbered event stops matching
 * its own history. This endpoint answers the question that decides whether the
 * fix is a query change or actual discovery: of the events missing a cut, how
 * many have a code sitting under a different slug in the same city?
 *
 * Read-only, and makes no upstream requests.
 *
 *   GET /api/code-audit?year=2026
 */

type Row = {
  slug: string;
  city: string;
  year: number;
  code: string | null;
};

function normalizeCity(city: string) {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export async function GET(request: NextRequest) {
  await ensureByesColumn();
  const year = Number(request.nextUrl.searchParams.get('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year)) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 });
  }

  // Every code we hold, from either place it can be written: the edition's own
  // source_url, or the source_notes of a cut already imported for it.
  const known = await pool.query<Row>(
    `
    select t.slug,
           t.city,
           te.year,
           coalesce(
             (regexp_match(te.source_url,   '/posting/\\d+/(\\d+)/'))[1],
             (regexp_match(cs.source_notes, '/posting/\\d+/(\\d+)/'))[1]
           ) as code
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.year between $1 - 4 and $1
    `,
    [year]
  );

  const codeBySlug = new Map<string, { code: string; year: number }>();
  const codeByCity = new Map<string, { code: string; year: number; slug: string }[]>();
  for (const row of known.rows) {
    if (!row.code) continue;
    const bySlug = codeBySlug.get(row.slug);
    if (!bySlug || row.year > bySlug.year) codeBySlug.set(row.slug, { code: row.code, year: row.year });
    const cityKey = normalizeCity(row.city ?? '');
    if (!cityKey) continue;
    const list = codeByCity.get(cityKey) ?? [];
    if (!list.some((e) => e.code === row.code && e.slug === row.slug)) {
      list.push({ code: row.code, year: row.year, slug: row.slug });
    }
    codeByCity.set(cityKey, list);
  }

  // The static catalogue is a third source, and the one the cut importer trusts
  // most. Included so an event that is only missing because of a slug mismatch
  // against the catalogue shows up here too.
  const catalogueByCity = new Map<string, { code: string; slug: string; year: number }[]>();
  for (const entry of ALL_EDITIONS) {
    const code = entry.edition.protennislive_code;
    if (!code) continue;
    const cityKey = normalizeCity(entry.tournament.city);
    const list = catalogueByCity.get(cityKey) ?? [];
    if (!list.some((e) => e.code === code)) {
      list.push({ code, slug: entry.tournament.slug, year: entry.edition.year });
    }
    catalogueByCity.set(cityKey, list);
  }

  // Events played this season that still have no singles main cut.
  const missing = await pool.query<{ slug: string; city: string; level: string; week: number | null; start_date: Date | string | null }>(
    `
    select t.slug, t.city, te.level, te.week, te.start_date
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.year = $1
      and te.status = 'held'
      and te.level not ilike 'ITF%'
      and te.start_date is not null
      and te.start_date <= current_date
      and not exists (
        select 1 from cutoff_snapshots cs
        where cs.tournament_edition_id = te.id
          and cs.event_type = 'singles'
          and cs.draw_type = 'main'
          and (cs.last_direct_acceptance_rank is not null or cs.byes_count is not null)
      )
    order by te.start_date desc
    `,
    [year]
  );

  const recoverableByCity: unknown[] = [];
  const alreadyHaveCode: unknown[] = [];
  const needsDiscovery: unknown[] = [];

  for (const row of missing.rows) {
    const iso = row.start_date instanceof Date
      ? row.start_date.toISOString().slice(0, 10)
      : (row.start_date as string | null);
    const base = { slug: row.slug, city: row.city, level: row.level, week: row.week, startDate: iso };

    const own = codeBySlug.get(row.slug);
    if (own) {
      alreadyHaveCode.push({ ...base, code: own.code, from: `own slug, ${own.year}` });
      continue;
    }

    const cityKey = normalizeCity(row.city ?? '');
    const fromDb = (codeByCity.get(cityKey) ?? []).filter((e) => e.slug !== row.slug);
    const fromCatalogue = (catalogueByCity.get(cityKey) ?? []).filter((e) => e.slug !== row.slug);
    const candidates = [
      ...fromDb.map((e) => ({ code: e.code, slug: e.slug, year: e.year, source: 'db' })),
      ...fromCatalogue.map((e) => ({ code: e.code, slug: e.slug, year: e.year, source: 'catalogue' })),
    ];

    if (candidates.length > 0) recoverableByCity.push({ ...base, candidates });
    else needsDiscovery.push(base);
  }

  return NextResponse.json({
    ok: true,
    year,
    missingCount: missing.rows.length,
    summary: {
      alreadyHaveCode: alreadyHaveCode.length,
      recoverableByCity: recoverableByCity.length,
      needsDiscovery: needsDiscovery.length,
    },
    // Has a code under its own slug — so the PDF is reachable and the cut is
    // missing for some other reason (unpublished sheet, fetch refused, parse).
    alreadyHaveCode,
    // Shares a city with something that has a code. A candidate here is a
    // suggestion, not a fact: two different events can share a city, so each
    // one still has to be confirmed against the posting's own header.
    recoverableByCity,
    // No code anywhere, under any slug, in this city. These are the only ones
    // that genuinely need probing.
    needsDiscovery,
  });
}
