import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from '@/lib/atp-week';
import slugify from 'slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Build permanent code → edition lookup from tournament-data.ts (2026 canonical data)
const CODE_TO_EDITION = new Map(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [Number(e.edition.protennislive_code), e])
);

type SackmannTournament = {
  tourneyId: string;
  code: number;
  name: string;
  surface: string;
  startDate: string; // YYYY-MM-DD
};

async function fetchSackmannChallengerList(year: number): Promise<SackmannTournament[]> {
  const url = `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_${year}.csv`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`JeffSackmann fetch failed: ${res.status} for year ${year}`);

  const text = await res.text();
  const lines = text.split('\n');
  if (lines.length < 2) throw new Error('CSV appears empty');

  const headers = lines[0].replace(/\r/g, '').split(',');
  const col = (name: string) => headers.indexOf(name);

  const idIdx = col('tourney_id');
  const nameIdx = col('tourney_name');
  const surfaceIdx = col('surface');
  const dateIdx = col('tourney_date');
  const levelIdx = col('tourney_level');

  if ([idIdx, nameIdx, surfaceIdx, dateIdx, levelIdx].some((i) => i === -1)) {
    throw new Error(`Missing expected columns. Headers: ${headers.join(', ')}`);
  }

  const seen = new Map<string, SackmannTournament>();

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.replace(/\r/g, '').trim();
    if (!line) continue;

    const cols = line.split(',');
    const level = cols[levelIdx]?.trim() ?? '';
    // 'C' = Challenger in JeffSackmann's tourney_level encoding
    if (level !== 'C') continue;

    const tourneyId = cols[idIdx]?.trim() ?? '';
    if (seen.has(tourneyId)) continue;

    // tourney_id format: "2025-0339" or "2025-7393" → strip year, parse int (drops leading zeros)
    const codePart = tourneyId.split('-')[1];
    if (!codePart) continue;
    const code = parseInt(codePart, 10);
    if (isNaN(code) || code <= 0) continue;

    const rawDate = cols[dateIdx]?.trim() ?? '';
    if (rawDate.length !== 8) continue;
    const startDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    seen.set(tourneyId, {
      tourneyId,
      code,
      name: cols[nameIdx]?.trim() ?? '',
      surface: cols[surfaceIdx]?.trim() ?? 'Hard',
      startDate,
    });
  }

  return Array.from(seen.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

async function ensureTournamentRow(
  slug: string,
  name: string,
  city: string,
  country: string | null
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set
       name = excluded.name,
       city = excluded.city,
       country = excluded.country,
       updated_at = now()
     returning id`,
    [slug, name, city, country]
  );
  return result.rows[0].id;
}

async function ensureEditionRow(
  tournamentId: string,
  year: number,
  week: number,
  startDate: string,
  level: string,
  surface: string,
  source: string
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, level, surface,
       indoor, source, status, updated_at
     ) values ($1, $2, $3, $4, $5, $6, false, $7, 'held', now())
     on conflict (tournament_id, year) do update set
       week = excluded.week,
       start_date = excluded.start_date,
       level = excluded.level,
       surface = excluded.surface,
       source = excluded.source,
       status = 'held',
       updated_at = now()
     returning id`,
    [tournamentId, year, week, startDate, level, surface, source]
  );
  return result.rows[0].id;
}

async function tryImportCut(
  editionId: string,
  code: number,
  year: number,
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying',
  pdfNames: string[]
): Promise<{ ok: boolean; pdfUrl?: string; rank?: number | null }> {
  const baseUrl = `https://www.protennislive.com/posting/${year}/${code}`;

  for (const pdfName of pdfNames) {
    const pdfUrl = `${baseUrl}/${pdfName}`;
    try {
      const parsed = await fetchAndParseOfficialPdfCutoff(pdfUrl);
      // Skip results-sheet PDFs served at entry-list URLs: they parse without
      // throwing but have no rank data, so recording them would mask the gap.
      const hasRank =
        parsed.last_direct_acceptance_rank !== null ||
        parsed.challenger_doubles_advanced_cut_rank !== null ||
        parsed.challenger_doubles_onsite_cut_rank !== null;
      if (!hasRank) continue;
      await pool.query(
        `insert into cutoff_snapshots (
           tournament_edition_id, event_type, draw_type, source_type,
           last_direct_acceptance_rank, last_direct_acceptance_player_name,
           last_alternate_rank, last_alternate_player_name,
           challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
           challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
           parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
         ) values (
           $1, $2, $3, 'official_pdf',
           $4, $5,
           null, null,
           $6, null, $7, null,
           now(), 'official-pdf-bottom-left-v4',
           $8, $9, $10, now()
         )
         on conflict (tournament_edition_id, event_type, draw_type) do update set
           last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
           last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
           challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
           challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
           parsed_at = excluded.parsed_at,
           source_notes = excluded.source_notes,
           alternate_entries_count = excluded.alternate_entries_count,
           lucky_loser_count = excluded.lucky_loser_count,
           updated_at = now()`,
        [
          editionId, eventType, drawType,
          parsed.last_direct_acceptance_rank,
          parsed.last_direct_acceptance_name,
          parsed.challenger_doubles_advanced_cut_rank,
          parsed.challenger_doubles_onsite_cut_rank,
          `Official PDF: ${pdfUrl}`,
          parsed.alternate_entries_count,
          parsed.lucky_loser_count,
        ]
      );
      return { ok: true, pdfUrl, rank: parsed.last_direct_acceptance_rank };
    } catch {
      // try next PDF name
    }
  }

  return { ok: false };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : 2025;

  if (![2024, 2025, 2026].includes(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024, 2025, or 2026' }, { status: 400 });
  }

  const limit = Math.min(Number(params.get('limit') ?? '100'), 250);
  const offset = Number(params.get('offset') ?? '0');

  let allTournaments: SackmannTournament[];
  try {
    allTournaments = await fetchSackmannChallengerList(year);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch JeffSackmann data' },
      { status: 500 }
    );
  }

  const page = allTournaments.slice(offset, offset + limit);

  const imported = [];
  const skipped = [];
  const failed = [];

  for (const t of page) {
    try {
      const editionEntry = CODE_TO_EDITION.get(t.code);

      let slug: string;
      let name: string;
      let city: string;
      let country: string | null;
      let level: string;
      let source: string;

      let canonicalStartDate: string | null = null;
      let canonicalWeek: number | null = null;

      if (editionEntry) {
        slug = editionEntry.tournament.slug;
        name = editionEntry.tournament.name;
        city = editionEntry.tournament.city;
        country = editionEntry.tournament.country;
        level = editionEntry.edition.level;
        source = editionEntry.edition.source;
        // For the current season (2026), prefer canonical scheduled dates so
        // JeffSackmann's actual-play dates don't shift tournaments to the wrong week.
        // For historical imports (2024/2025), use JeffSackmann's actual dates.
        if (year === 2026) {
          canonicalStartDate = editionEntry.edition.start_date;
          canonicalWeek = editionEntry.edition.week;
        }
      } else {
        // Tournament not in our 2026 calendar — derive from JeffSackmann name.
        // JeffSackmann's `tourney_name` often has a trailing " CH" / " CH 2" tag
        // and we double-up name + city, which generated slugs like
        // "burnie-ch-burnie-ch". Strip the tag so the slug stays clean.
        const cleanedName = t.name.replace(/\s+CH(\s+\d+)?$/i, '$1').replace(/\s{2,}/g, ' ').trim();
        name = cleanedName;
        city = cleanedName;
        country = null;
        level = 'Challenger';
        source = 'atp_challenger_pdf';
        slug = slugify(cleanedName, { lower: true, strict: true, trim: true });
      }

      const effectiveStartDate = canonicalStartDate ?? t.startDate;
      // December starts belong to the next ATP season (e.g. Dec 30, 2025 = ATP 2026 Week 1)
      const editionYear = getAtpEditionYearForStartDate(effectiveStartDate, year);
      const week = canonicalWeek ?? (getAtpWeekForSeason(effectiveStartDate, editionYear) ?? 1);
      const tournamentId = await ensureTournamentRow(slug, name, city, country);
      const editionId = await ensureEditionRow(tournamentId, editionYear, week, effectiveStartDate, level, t.surface, source);

      const [singlesMain, singlesQual, doublesMain] = await Promise.all([
        tryImportCut(editionId, t.code, year, 'singles', 'main', ['mds.pdf', 'mds-1.pdf', 'mds-2.pdf', 'mds-3.pdf', 'md.pdf', 'ms.pdf', 'ad.pdf', 'mds-final.pdf']),
        tryImportCut(editionId, t.code, year, 'singles', 'qualifying', ['qs.pdf', 'qs-1.pdf', 'qs-2.pdf', 'q.pdf', 'qd.pdf', 'qsa.pdf', 'qs-final.pdf']),
        tryImportCut(editionId, t.code, year, 'doubles', 'main', ['mdd.pdf', 'mdd-1.pdf', 'mdd-2.pdf', 'mdd-3.pdf', 'md.pdf', 'dd.pdf', 'mdd-final.pdf']),
      ]);

      const anyPdf = singlesMain.ok || singlesQual.ok || doublesMain.ok;

      const entry = {
        slug,
        name,
        year: editionYear,
        week,
        code: t.code,
        surface: t.surface,
        startDate: t.startDate,
        inOurCalendar: Boolean(editionEntry),
        singles_main: singlesMain.ok ? singlesMain.rank : 'no_pdf',
        singles_qual: singlesQual.ok ? singlesQual.rank : 'no_pdf',
        doubles_main: doublesMain.ok ? doublesMain.rank : 'no_pdf',
      };

      if (anyPdf) {
        imported.push(entry);
      } else {
        skipped.push(entry);
      }
    } catch (err) {
      failed.push({
        code: t.code,
        name: t.name,
        year,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    year,
    totalInCsv: allTournaments.length,
    offset,
    limit,
    pageSize: page.length,
    hasMore: offset + limit < allTournaments.length,
    nextOffset: offset + limit < allTournaments.length ? offset + limit : null,
    importedCount: imported.length,
    skippedNoPdfCount: skipped.length,
    failedCount: failed.length,
    imported,
    skipped,
    failed,
  });
}
