import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_TO_CANONICAL_CODE = new Map<string, string>(ALL_EDITIONS.filter((e) => e.edition.protennislive_code).map((e) => [e.tournament.slug, String(e.edition.protennislive_code)]));
const SLUG_HAS_DOUBLES_QUALIFYING = new Set(ALL_EDITIONS.filter((e) => e.edition.has_doubles_qualifying).map((e) => e.tournament.slug));

type DrawKey = 'singles_main' | 'singles_qualifying' | 'doubles_main' | 'doubles_qualifying';
type Row = { edition_id: string; slug: string; name: string; year: number; start_date: string; level: string; source_url: string | null; has_singles_main: boolean; has_singles_qualifying: boolean; has_doubles_main: boolean; has_doubles_qualifying: boolean; tried_singles_main: boolean; tried_singles_qualifying: boolean; tried_doubles_main: boolean; tried_doubles_qualifying: boolean; source_notes: string[] };

function extractCodeFromTextSources(sources: Array<string | null | undefined>): string | null { for (const source of sources) { if (!source) continue; const match = source.match(/\/posting\/\d+\/(\d+)\//); if (match) return match[1]; } return null; }
const hasDraw = (r: Row, d: DrawKey) => d === 'singles_main' ? r.has_singles_main : d === 'singles_qualifying' ? r.has_singles_qualifying : d === 'doubles_main' ? r.has_doubles_main : r.has_doubles_qualifying;
const wasTried = (r: Row, d: DrawKey) => d === 'singles_main' ? r.tried_singles_main : d === 'singles_qualifying' ? r.tried_singles_qualifying : d === 'doubles_main' ? r.tried_doubles_main : r.tried_doubles_qualifying;

function expectedDraws(r: Row): DrawKey[] { const isChallenger = r.level.toLowerCase().includes('challenger'); const isAtp500 = r.level.includes('500') && !r.level.includes('1000'); const draws: DrawKey[] = ['singles_main', 'singles_qualifying', 'doubles_main']; if (!isChallenger && (isAtp500 || SLUG_HAS_DOUBLES_QUALIFYING.has(r.slug))) draws.push('doubles_qualifying'); return draws; }

export async function GET(request: NextRequest) {
  const includeFuture = request.nextUrl.searchParams.get('includeFuture') === 'true';
  const rows = await pool.query<Row>(`select te.id as edition_id,t.slug,t.name,te.year,te.start_date::text as start_date,te.level,te.source_url,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='singles' and cs.draw_type='main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='singles' and cs.draw_type='qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qualifying,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='doubles' and cs.draw_type='main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='doubles' and cs.draw_type='qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qualifying,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='singles' and cs.draw_type='main' and cs.source_type='official_pdf_not_found') as tried_singles_main,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='singles' and cs.draw_type='qualifying' and cs.source_type='official_pdf_not_found') as tried_singles_qualifying,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='doubles' and cs.draw_type='main' and cs.source_type='official_pdf_not_found') as tried_doubles_main,
    exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id=te.id and cs.event_type='doubles' and cs.draw_type='qualifying' and cs.source_type='official_pdf_not_found') as tried_doubles_qualifying,
    coalesce(array_agg(cs.source_notes) filter (where cs.source_notes is not null), array[]::text[]) as source_notes
    from tournament_editions te join tournaments t on t.id=te.tournament_id left join cutoff_snapshots cs on cs.tournament_edition_id=te.id
    where te.status='held' and te.start_date is not null and te.year>=2024
    group by te.id,t.slug,t.name,te.year,te.start_date,te.level,te.source_url order by te.year,te.start_date,t.name`);

  const today = new Date().toISOString().slice(0, 10);
  const grouped: Record<string, unknown[]> = { fillable_missing: [], no_protennislive_code: [], pdf_not_found_or_not_posted: [], future_or_unposted: [], invalid_expected_draw: [] };

  for (const r of rows.rows) {
    const future = r.start_date > today;
    const code = SLUG_TO_CANONICAL_CODE.get(r.slug) ?? extractCodeFromTextSources([r.source_url, ...r.source_notes]);
    const expected = expectedDraws(r);
    const missing = expected.filter((d) => !hasDraw(r, d));
    if (missing.length === 0) continue;
    const item = { slug: r.slug, name: r.name, year: r.year, start_date: r.start_date, level: r.level, code, missing_draws: missing };
    if (future && !includeFuture) { grouped.future_or_unposted.push(item); continue; }
    if (!code) { grouped.no_protennislive_code.push(item); continue; }
    if (missing.some((d) => !['singles_main', 'singles_qualifying', 'doubles_main', 'doubles_qualifying'].includes(d))) { grouped.invalid_expected_draw.push(item); continue; }
    if (missing.every((d) => wasTried(r, d))) { grouped.pdf_not_found_or_not_posted.push(item); continue; }
    grouped.fillable_missing.push(item);
  }

  return NextResponse.json({ ok: true, includeFuture, grouped });
}
