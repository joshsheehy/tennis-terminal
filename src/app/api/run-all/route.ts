import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchAndParseOfficialPdfCutoff } from '@/lib/cutoff-pdf-parser';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// All-in-one import endpoint. Call repeatedly until hasMore: false.
// Each call: runs cleanup (idempotent), then fills as many missing cuts
// as possible within a 22-second budget before returning.

const TIME_BUDGET_MS = 22000;

const SLUG_TO_CODE = new Map<string, string>(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [e.tournament.slug, String(e.edition.protennislive_code)])
);

const SLUG_HAS_DOUBLES_QUAL = new Set(
  ALL_EDITIONS.filter((e) => e.edition.has_doubles_qualifying).map((e) => e.tournament.slug)
);
const ALL_KNOWN_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

const PDF_PATTERNS = {
  singles_main: ['mds.pdf', 'mds-1.pdf', 'mds-2.pdf', 'mds-3.pdf', 'md.pdf', 'ms.pdf', 'ad.pdf', 'mds-final.pdf'],
  singles_qual: ['qs.pdf', 'qs-1.pdf', 'qs-2.pdf', 'q.pdf', 'qd.pdf', 'qsa.pdf', 'qs-final.pdf'],
  doubles_main: ['mdd.pdf', 'mdd-1.pdf', 'mdd-2.pdf', 'mdd-3.pdf', 'md.pdf', 'dd.pdf', 'mdd-final.pdf'],
  doubles_qual: ['qd.pdf', 'qd-1.pdf', 'qdd.pdf'],
};

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  year: number;
  start_date: string;
  level: string;
  source_url: string | null;
  has_singles_main: boolean;
  has_singles_qual: boolean;
  has_doubles_main: boolean;
  has_doubles_qual: boolean;
  recently_tried_singles_main: boolean;
  recently_tried_singles_qual: boolean;
  recently_tried_doubles_main: boolean;
  recently_tried_doubles_qual: boolean;
  existing_source_notes: string[];
};

// How long after a failed attempt we skip the draw before retrying. Keeps each
// run-all call making forward progress instead of looping over the same dead
// editions every time.
const TOMBSTONE_TTL = '6 hours';

function extractCodeFromTextSources(sources: Array<string | null | undefined>): string | null {
  const patterns = [
    /\/posting\/\d+\/(\d+)\//,
    /\/scores\/archive\/[^/]+\/(\d+)\/\d{4}\//,
    /\/atp-challenger-tour\/tournaments\/[^/]+\/(\d+)\//,
    /\/tournaments\/[^/]+\/(\d+)\//,
  ];

  for (const source of sources) {
    if (!source) continue;
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
}

async function tryFill(
  editionId: string,
  code: string,
  candidateYears: number[],
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying',
  pdfNames: string[]
): Promise<boolean> {
  // Race every candidate PDF in parallel. Without this, an edition with 5
  // dead candidate URLs (each costing ~8s of PTL+Wayback timeout) burns the
  // 22s budget by itself. With Promise.allSettled the slowest URL alone
  // bounds the wall time, and the first successful parse wins.
  const currentYear = new Date().getFullYear();
  for (const year of candidateYears) {
    const archiveFirst = year < currentYear;
    const baseUrl = `https://www.protennislive.com/posting/${year}/${code}`;
    const attempts = pdfNames.map(async (pdfName) => {
      const pdfUrl = `${baseUrl}/${pdfName}`;
      const parsed = await fetchAndParseOfficialPdfCutoff(pdfUrl, archiveFirst);
      const hasRank =
        parsed.last_direct_acceptance_rank !== null ||
        parsed.challenger_doubles_advanced_cut_rank !== null ||
        parsed.challenger_doubles_onsite_cut_rank !== null;
      if (!hasRank) throw new Error('no rank data');
      return { parsed, pdfUrl };
    });
    const results = await Promise.allSettled(attempts);
    const winner = results.find((r) => r.status === 'fulfilled') as
      | PromiseFulfilledResult<{ parsed: Awaited<ReturnType<typeof fetchAndParseOfficialPdfCutoff>>; pdfUrl: string }>
      | undefined;
    if (!winner) continue;
    const { parsed, pdfUrl } = winner.value;
    await pool.query(
      `insert into cutoff_snapshots (
         tournament_edition_id, event_type, draw_type, source_type,
         last_direct_acceptance_rank, last_direct_acceptance_player_name,
         last_alternate_rank, last_alternate_player_name,
         challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
         challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
         parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
       ) values (
         $1, $2, $3, 'official_pdf', $4, $5, null, null, $6, null, $7, null,
         now(), 'official-pdf-bottom-left-v4', $8, $9, $10, now()
       )
       on conflict (tournament_edition_id, event_type, draw_type) do update set
         last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
         last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
         challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
         challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
         parsed_at = excluded.parsed_at, source_notes = excluded.source_notes,
         alternate_entries_count = excluded.alternate_entries_count,
         lucky_loser_count = excluded.lucky_loser_count, updated_at = now()`,
      [
        editionId, eventType, drawType,
        parsed.last_direct_acceptance_rank, parsed.last_direct_acceptance_name,
        parsed.challenger_doubles_advanced_cut_rank, parsed.challenger_doubles_onsite_cut_rank,
        `Official PDF: ${pdfUrl}`,
        parsed.alternate_entries_count, parsed.lucky_loser_count,
      ]
    );
    return true;
  }
  return false;
}

async function markDrawAttempted(
  editionId: string,
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying'
) {
  // Tombstone: we tried every candidate PDF for this draw and none worked.
  // Stops run-all from re-burning the time budget on the same dead draw for a
  // while. If a real PDF turns up later, tryFill's full upsert above replaces
  // this row; the case-expression here makes sure we never clobber a real
  // rank row with this placeholder.
  await pool.query(
    `insert into cutoff_snapshots (
       tournament_edition_id, event_type, draw_type, source_type,
       parsed_at, parser_version, source_notes, updated_at
     ) values (
       $1, $2, $3, 'official_pdf', now(), 'tombstone-v1', 'PDF_NOT_FOUND', now()
     )
     on conflict (tournament_edition_id, event_type, draw_type) do update set
       source_notes = case
         when cutoff_snapshots.last_direct_acceptance_rank is not null
           or cutoff_snapshots.challenger_doubles_advanced_cut_rank is not null
           or cutoff_snapshots.challenger_doubles_onsite_cut_rank is not null
         then cutoff_snapshots.source_notes
         else excluded.source_notes end,
       parsed_at = case
         when cutoff_snapshots.last_direct_acceptance_rank is not null
           or cutoff_snapshots.challenger_doubles_advanced_cut_rank is not null
           or cutoff_snapshots.challenger_doubles_onsite_cut_rank is not null
         then cutoff_snapshots.parsed_at
         else excluded.parsed_at end,
       updated_at = case
         when cutoff_snapshots.last_direct_acceptance_rank is not null
           or cutoff_snapshots.challenger_doubles_advanced_cut_rank is not null
           or cutoff_snapshots.challenger_doubles_onsite_cut_rank is not null
         then cutoff_snapshots.updated_at
         else now() end`,
    [editionId, eventType, drawType]
  );
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const force = request.nextUrl.searchParams.get('force') === 'true';

  // ── Phase 1: Cleanup (fast, idempotent) ──────────────────────────────────────────

  const namesResult = await pool.query(
    `update tournaments
     set name = trim(regexp_replace(name, '\\s+[Cc][Hh](\\s+\\d+)?$', '')),
         city = trim(regexp_replace(city, '\\s+[Cc][Hh](\\s+\\d+)?$', ''))
     where name ~* '\\s+ch(\\s+\\d+)?$' or city ~* '\\s+ch(\\s+\\d+)?$'`
  );

  // Stored week = days since the ATP season's Week 1 Monday / 7 + 1, clamped to 1.
  // Season start rule matches src/lib/atp-week.ts: Mon/Tue/Wed Jan 1 rolls back to
  // the Monday on or before; Thu/Fri/Sat/Sun Jan 1 rolls forward to the next Monday
  // (so 2026 Jan 5 is week 1, not week 2).
  await Promise.all(
    [2024, 2025, 2026].map((year) =>
      pool.query(
        `update tournament_editions te
         set week = greatest(
           1,
           (te.start_date::date - (
             make_date(te.year, 1, 1)
             + case
                 when extract(isodow from make_date(te.year, 1, 1))::int <= 3
                   then 1 - extract(isodow from make_date(te.year, 1, 1))::int
                 else 8 - extract(isodow from make_date(te.year, 1, 1))::int
               end
           )) / 7 + 1
         )
         where te.year = $1
           and te.start_date is not null
           and not (extract(month from te.start_date) = 12 and extract(year from te.start_date) = te.year)`,
        [year]
      )
    )
  );

  // ── Phase 2: Find all incomplete editions ────────────────────────────────────

  const editionsResult = await pool.query<EditionRow>(
    `select
       te.id as edition_id,
       t.slug,
       t.name,
       te.year,
       te.start_date::text as start_date,
       te.level,
       te.source_url,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.last_direct_acceptance_rank is not null) as has_singles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_singles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and (cs.last_direct_acceptance_rank is not null or cs.challenger_doubles_advanced_cut_rank is not null or cs.challenger_doubles_onsite_cut_rank is not null)) as has_doubles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.last_direct_acceptance_rank is not null) as has_doubles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'main' and cs.source_notes = 'PDF_NOT_FOUND' and cs.updated_at > now() - interval '${TOMBSTONE_TTL}') as recently_tried_singles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'singles' and cs.draw_type = 'qualifying' and cs.source_notes = 'PDF_NOT_FOUND' and cs.updated_at > now() - interval '${TOMBSTONE_TTL}') as recently_tried_singles_qual,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'main' and cs.source_notes = 'PDF_NOT_FOUND' and cs.updated_at > now() - interval '${TOMBSTONE_TTL}') as recently_tried_doubles_main,
       exists(select 1 from cutoff_snapshots cs where cs.tournament_edition_id = te.id and cs.event_type = 'doubles' and cs.draw_type = 'qualifying' and cs.source_notes = 'PDF_NOT_FOUND' and cs.updated_at > now() - interval '${TOMBSTONE_TTL}') as recently_tried_doubles_qual,
       coalesce(array_agg(cs.source_notes) filter (where cs.source_notes is not null), array[]::text[]) as existing_source_notes
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
     where te.status = 'held'
       and te.start_date is not null
       and te.year >= 2024
     group by te.id, t.slug, t.name, te.year, te.start_date, te.level, te.source_url
     order by te.year, te.start_date, t.name`
  );

  // An edition is "actionable" if at least one expected draw is still missing
  // AND we haven't recently tombstoned that draw (unless force=true).
  const incomplete = editionsResult.rows.filter((r) => {
    const isChallenger = r.level.toLowerCase().includes('challenger');
    const needsDoublesQual = !isChallenger && (
      SLUG_HAS_DOUBLES_QUAL.has(r.slug) ||
      (!ALL_KNOWN_SLUGS.has(r.slug) && (r.level.includes('500') || r.level.includes('1000')))
    );
    const needsSinglesMain = !r.has_singles_main && (force || !r.recently_tried_singles_main);
    const needsSinglesQual = !r.has_singles_qual && (force || !r.recently_tried_singles_qual);
    const needsDoublesMain = !r.has_doubles_main && (force || !r.recently_tried_doubles_main);
    const needsDoublesQualifying =
      needsDoublesQual && !r.has_doubles_qual && (force || !r.recently_tried_doubles_qual);
    return needsSinglesMain || needsSinglesQual || needsDoublesMain || needsDoublesQualifying;
  });

  // ── Phase 3: Fill within time budget ───────────────────────────────────────

  let filled = 0;
  let noCode = 0;
  let processed = 0;
  let timedOut = false;

  for (const r of incomplete) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    processed++;

    const code = SLUG_TO_CODE.get(r.slug) ?? extractCodeFromTextSources([r.source_url, ...r.existing_source_notes]);
    if (!code) {
      noCode++;
      continue;
    }

    // Always pull only the season year's PDF. The old code also tried
    // r.year-1 / r.year+1 / start_date.year ± 1 to be tolerant of PTL's
    // URL conventions, but that was actively wrong: if PTL still served
    // the previous season's PDF at the neighbour-year URL, we accepted
    // last year's cut data and stored it against this year's edition.
    // That's the "same cut two years in a row" bug. For Brisbane-style
    // December starts, r.year already holds the correct ATP season year.
    const candidateYears = [r.year];
    const isChallenger = r.level.toLowerCase().includes('challenger');
    const needsDoublesQual = !isChallenger && (
      SLUG_HAS_DOUBLES_QUAL.has(r.slug) ||
      (!ALL_KNOWN_SLUGS.has(r.slug) && (r.level.includes('500') || r.level.includes('1000')))
    );

    type DrawAttempt = {
      eventType: 'singles' | 'doubles';
      drawType: 'main' | 'qualifying';
      run: () => Promise<boolean>;
    };
    const drawAttempts: DrawAttempt[] = [];
    if (!r.has_singles_main && (force || !r.recently_tried_singles_main)) {
      drawAttempts.push({ eventType: 'singles', drawType: 'main', run: () => tryFill(r.edition_id, code, candidateYears, 'singles', 'main', PDF_PATTERNS.singles_main) });
    }
    if (!r.has_singles_qual && (force || !r.recently_tried_singles_qual)) {
      drawAttempts.push({ eventType: 'singles', drawType: 'qualifying', run: () => tryFill(r.edition_id, code, candidateYears, 'singles', 'qualifying', PDF_PATTERNS.singles_qual) });
    }
    if (!r.has_doubles_main && (force || !r.recently_tried_doubles_main)) {
      drawAttempts.push({ eventType: 'doubles', drawType: 'main', run: () => tryFill(r.edition_id, code, candidateYears, 'doubles', 'main', PDF_PATTERNS.doubles_main) });
    }
    if (needsDoublesQual && !r.has_doubles_qual && (force || !r.recently_tried_doubles_qual)) {
      drawAttempts.push({ eventType: 'doubles', drawType: 'qualifying', run: () => tryFill(r.edition_id, code, candidateYears, 'doubles', 'qualifying', PDF_PATTERNS.doubles_qual) });
    }

    const results = await Promise.all(drawAttempts.map((d) => d.run()));
    if (results.some(Boolean)) filled++;
    // Tombstone draws that came up empty so the next call doesn't waste budget here.
    await Promise.all(
      drawAttempts.map((d, i) => (results[i] ? Promise.resolve() : markDrawAttempted(r.edition_id, d.eventType, d.drawType)))
    );
  }

  const remaining = incomplete.length - processed;
  const hasMore = timedOut && remaining > 0;

  return NextResponse.json({
    ok: true,
    namesFixed: namesResult.rowCount ?? 0,
    totalIncomplete: incomplete.length,
    processedThisCall: processed,
    filled,
    noCode,
    remaining,
    hasMore,
    force,
    message: hasMore
      ? `Filled ${filled} editions. ${remaining} remaining — call again to continue.`
      : `Done. Filled ${filled} editions. ${noCode} have no ProTennisLive code. Use ?force=true to retry editions previously marked PDF_NOT_FOUND.`,
  });
}
