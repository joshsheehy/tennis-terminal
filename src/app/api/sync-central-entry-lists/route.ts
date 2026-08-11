import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  normalizeCentralTournamentKey,
  parseCentralAtpEntryPage,
  selectCentralWeekForCities,
  type CentralEntryTournament,
} from '@/lib/central-entry-list-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CENTRAL_SOURCE_URL = 'https://entries.ticktocktennis.com/atp';
const SOURCE_TYPE = 'central_public_aggregator_experiment';

type EditionRow = {
  edition_id: string;
  name: string;
  city: string;
  start_date: string | Date;
  level: string;
};

function isoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nextMondayUtc(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay();
  const days = day === 1 ? 7 : (8 - day) % 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requestedWeekStart(request: NextRequest): string | null {
  const value = request.nextUrl.searchParams.get('week') ?? nextMondayUtc();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function fetchCentralPage(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(CENTRAL_SOURCE_URL, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; TennisCutsEntryListExperiment/1.0)',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`central source returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function findSourceTournament(
  sourceTournaments: CentralEntryTournament[],
  edition: EditionRow
): CentralEntryTournament | null {
  const cityKey = normalizeCentralTournamentKey(edition.city);
  const exactCity = sourceTournaments.find(
    (t) => normalizeCentralTournamentKey(t.cityKey) === cityKey
  );
  if (exactCity) return exactCity;

  const nameKey = normalizeCentralTournamentKey(edition.name);
  return sourceTournaments.find((t) => {
    const sourceKey = normalizeCentralTournamentKey(t.sourceName);
    return sourceKey.includes(cityKey) || sourceKey.includes(nameKey) || nameKey.includes(normalizeCentralTournamentKey(t.cityKey));
  }) ?? null;
}

export async function GET(request: NextRequest) {
  const weekStart = requestedWeekStart(request);
  if (!weekStart) {
    return NextResponse.json({ ok: false, error: 'week must be YYYY-MM-DD' }, { status: 400 });
  }

  const editions = await pool.query<EditionRow>(
    `
    select te.id as edition_id, t.name, t.city, te.start_date, te.level
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where te.status = 'held'
      and te.level ilike 'Challenger%'
      and te.start_date >= $1::date
      and te.start_date < $1::date + interval '7 days'
    order by te.start_date, t.name
    `,
    [weekStart]
  );

  if (editions.rows.length === 0) {
    return NextResponse.json({
      ok: false,
      error: `No Challenger editions found for week starting ${weekStart}`,
    }, { status: 404 });
  }

  const html = await fetchCentralPage();
  const parsed = parseCentralAtpEntryPage(html);
  const selected = selectCentralWeekForCities(parsed, editions.rows.map((row) => row.city));
  if (!selected.week) {
    return NextResponse.json({
      ok: false,
      error: 'Could not locate a centralized week block matching the database schedule',
      databaseCities: editions.rows.map((row) => row.city),
      parsedWeekCount: parsed.weeks.length,
    }, { status: 502 });
  }

  const tournaments = editions.rows.map((edition) => {
    const source = findSourceTournament(selected.week!.tournaments, edition);
    return {
      editionId: edition.edition_id,
      tournament: edition.name,
      city: edition.city,
      startDate: isoDate(edition.start_date),
      level: edition.level,
      sourceName: source?.sourceName ?? null,
      sourceLevel: source?.level ?? null,
      surface: source?.surface ?? null,
      main: source?.main ?? [],
      wildCards: source?.wildCards ?? [],
      qualifying: source?.qualifying ?? [],
      qualifyingNextIn: source?.qualifyingNextIn ?? [],
      released: Boolean(source && (
        source.main.length || source.wildCards.length || source.qualifying.length || source.qualifyingNextIn.length
      )),
    };
  });

  const matched = tournaments.filter((t) => t.sourceName !== null).length;
  const released = tournaments.filter((t) => t.released).length;
  const snapshotJson = JSON.stringify(tournaments);
  const contentHash = createHash('sha256').update(snapshotJson).digest('hex');

  const latest = await pool.query<{ content_hash: string }>(
    `select content_hash
     from central_entry_list_week_snapshots
     where tour = 'atp' and week_start = $1::date
     order by created_at desc
     limit 1`,
    [weekStart]
  );

  if (latest.rows[0]?.content_hash === contentHash) {
    return NextResponse.json({
      ok: true,
      weekStart,
      changed: false,
      matched,
      expected: editions.rows.length,
      released,
      sourceUpdatedText: parsed.sourceUpdatedText,
      renderIndex: selected.week.renderIndex,
    });
  }

  await pool.query(
    `
    insert into central_entry_list_week_snapshots (
      tour, week_start, source_type, source_url, source_updated_text,
      content_hash, tournament_count, tournaments
    ) values ('atp', $1::date, $2, $3, $4, $5, $6, $7::jsonb)
    on conflict (tour, week_start, content_hash) do nothing
    `,
    [
      weekStart,
      SOURCE_TYPE,
      CENTRAL_SOURCE_URL,
      parsed.sourceUpdatedText,
      contentHash,
      tournaments.length,
      snapshotJson,
    ]
  );

  return NextResponse.json({
    ok: true,
    weekStart,
    changed: true,
    matched,
    expected: editions.rows.length,
    released,
    sourceUpdatedText: parsed.sourceUpdatedText,
    renderIndex: selected.week.renderIndex,
    tournaments: tournaments.map((t) => ({
      tournament: t.tournament,
      city: t.city,
      sourceName: t.sourceName,
      released: t.released,
      main: t.main.length,
      qualifying: t.qualifying.length,
      qualifyingNextIn: t.qualifyingNextIn.length,
    })),
  });
}
