import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ITF_CUTOFFS_2025, type ItfCutoff2025 } from '@/lib/itf-cutoffs-2025';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Import the 2025 ITF World Tennis Tour strength cutoffs (from the official PDF,
// embedded in itf-cutoffs-2025.ts) onto the matching ITF editions:
//   - singles main      → main-draw cutoff rank (cutMD)
//   - singles qualifying → qualifying cutoff rank (cutQ) + # byes in qualifying
// No alternates/lucky-losers (the PDF carries none for ITF).
//
// Matching: ITF editions are keyed by level ('ITF M15'/'ITF M25'), city, and
// start_date. We match each PDF row to the edition with the same tier + city
// whose start_date is within a few days of the row's date (which disambiguates
// the same city running many weeks). Dry-run by default; ?apply=true writes.

type CutKind = { rank: number | null; itfRanking: boolean; status: 'UR' | 'NR' | 'Bye' | null; raw: string };

function parseCut(raw: string): CutKind {
  const r = (raw ?? '').trim();
  if (r === 'UR' || r === 'NR' || r === 'Bye') return { rank: null, itfRanking: false, status: r, raw: r };
  const itf = r.startsWith('*');
  const n = Number.parseInt(itf ? r.slice(1) : r, 10);
  return { rank: Number.isFinite(n) ? n : null, itfRanking: itf, status: null, raw: r };
}

// Accent-insensitive, punctuation-insensitive key for city matching.
function norm(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const DAY = 24 * 60 * 60 * 1000;

type EditionRow = { id: string; slug: string; city: string; level: string; start_date: string };

function findMatch(row: ItfCutoff2025, editions: EditionRow[]): { match: EditionRow | null; ambiguous: EditionRow[] } {
  const tierLevel = `itf ${row.tier}`.toLowerCase();
  const cityKey = norm(row.city);
  const target = new Date(`${row.startDate}T00:00:00Z`).getTime();
  const candidates = editions.filter(
    (e) => e.level.toLowerCase() === tierLevel && norm(e.city) === cityKey
  );
  const within = candidates
    .map((e) => ({ e, d: Math.abs(new Date(`${e.start_date}T00:00:00Z`).getTime() - target) }))
    .filter((x) => x.d <= 5 * DAY)
    .sort((a, b) => a.d - b.d);
  if (within.length === 0) return { match: null, ambiguous: [] };
  return { match: within[0].e, ambiguous: within.slice(1).map((x) => x.e) };
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  // All ITF editions across the 2025 season window (incl. the late-Dec-2024
  // week-1 carryover).
  const editionsResult = await pool.query<EditionRow>(
    `select te.id, t.slug, t.city, te.level, te.start_date::text as start_date
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.level ilike 'ITF%'
       and te.start_date >= date '2024-12-01'
       and te.start_date <= date '2025-12-31'`
  );
  const editions = editionsResult.rows;

  const matched: Array<{ row: ItfCutoff2025; editionId: string; slug: string }> = [];
  const unmatched: ItfCutoff2025[] = [];
  let ambiguousCount = 0;

  for (const row of ITF_CUTOFFS_2025) {
    const { match, ambiguous } = findMatch(row, editions);
    if (ambiguous.length > 0) ambiguousCount += 1;
    if (match) matched.push({ row, editionId: match.id, slug: match.slug });
    else unmatched.push(row);
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      pdfRowCount: ITF_CUTOFFS_2025.length,
      itfEditionsInWindow: editions.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      ambiguousResolvedCount: ambiguousCount,
      matchedSample: matched.slice(0, 10).map((m) => ({ slug: m.slug, city: m.row.city, tier: m.row.tier, week: m.row.week, cutMD: m.row.cutMD, cutQ: m.row.cutQ, byes: m.row.qualByes })),
      unmatchedSample: unmatched.slice(0, 40).map((r) => ({ tier: r.tier, city: r.city, week: r.week, startDate: r.startDate })),
      note: 'Re-run with ?apply=true to write singles main + qualifying cuts and qualifying byes onto the matched editions.',
    });
  }

  // Self-migrate the byes column (established pattern in this codebase).
  await pool.query(`alter table cutoff_snapshots add column if not exists qualifying_byes_count int`);

  let wroteMain = 0;
  let wroteQual = 0;
  const failed: Array<{ slug: string; error: string }> = [];

  for (const m of matched) {
    const md = parseCut(m.row.cutMD);
    const q = parseCut(m.row.cutQ);
    try {
      // Singles main — cutMD is always a rank.
      const mdNotes = `2025 ITF strength cutoffs PDF. Main-draw cut: ${md.raw}${md.itfRanking ? ' (ITF World Ranking)' : ''}.`;
      await pool.query(
        `insert into cutoff_snapshots (
           tournament_edition_id, event_type, draw_type, source_type,
           last_direct_acceptance_rank, parsed_at, parser_version, source_notes, updated_at
         ) values ($1, 'singles', 'main', 'itf_strength_pdf', $2, now(), 'itf-strength-2025', $3, now())
         on conflict (tournament_edition_id, event_type, draw_type) do update set
           source_type = excluded.source_type,
           last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
           parsed_at = excluded.parsed_at,
           parser_version = excluded.parser_version,
           source_notes = excluded.source_notes,
           updated_at = now()`,
        [m.editionId, md.rank, mdNotes]
      );
      wroteMain += 1;

      // Singles qualifying — cutQ may be a rank or UR/NR/Bye; byes alongside.
      const statusText =
        q.status === 'Bye' ? 'qualifying draw was not full' :
        q.status === 'UR' ? 'last qualifying acceptance unranked' :
        q.status === 'NR' ? 'last qualifying acceptance on national ranking' : null;
      const qNotes = `2025 ITF strength cutoffs PDF. Qualifying cut: ${q.raw}${q.itfRanking ? ' (ITF World Ranking)' : ''}${statusText ? ` (${statusText})` : ''}. Byes in qualifying: ${m.row.qualByes}.`;
      await pool.query(
        `insert into cutoff_snapshots (
           tournament_edition_id, event_type, draw_type, source_type,
           last_direct_acceptance_rank, qualifying_byes_count,
           parsed_at, parser_version, source_notes, updated_at
         ) values ($1, 'singles', 'qualifying', 'itf_strength_pdf', $2, $3, now(), 'itf-strength-2025', $4, now())
         on conflict (tournament_edition_id, event_type, draw_type) do update set
           source_type = excluded.source_type,
           last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
           qualifying_byes_count = excluded.qualifying_byes_count,
           parsed_at = excluded.parsed_at,
           parser_version = excluded.parser_version,
           source_notes = excluded.source_notes,
           updated_at = now()`,
        [m.editionId, q.rank, m.row.qualByes, qNotes]
      );
      wroteQual += 1;
    } catch (e) {
      failed.push({ slug: m.slug, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    dryRun: false,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    wroteMainCuts: wroteMain,
    wroteQualifyingCuts: wroteQual,
    failedCount: failed.length,
    failed: failed.slice(0, 20),
  });
}
