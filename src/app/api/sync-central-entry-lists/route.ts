import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { parseEntryListPage, type EntryListTournament } from '@/lib/entry-list-source';

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

function sourceDateLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T12:00:00Z`);
  return `${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`;
}

function normalizePlace(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(challenger|open|international|country club|cars|advantage|europcar)\b/g, ' ')
    .replace(/\s+\d+\s*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchEdition(source: EntryListTournament, editions: EditionRow[]): EditionRow | null {
  const sourceKey = normalizePlace(source.name);
  const exactCity = editions.find((edition) => normalizePlace(edition.city) === sourceKey);
  if (exactCity) return exactCity;
  return editions.find((edition) => {
    const city = normalizePlace(edition.city);
    const name = normalizePlace(edition.name);
    return sourceKey === city || sourceKey === name || sourceKey.includes(city) || city.includes(sourceKey);
  }) ?? null;
}

function sourceUpdatedText(html: string): string | null {
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const match = visible.match(/(?:Data\s+updated|Updated)\s+(.{1,80}?)(?:ticktocktennis\.com|$)/i);
  return match?.[1]?.trim() ?? null;
}

async function fetchCentralPage(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(CENTRAL_SOURCE_URL, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; TennisCutsEntryListExperiment/2.0)',
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

  const html = await fetchCentralPage();
  const weeks = parseEntryListPage(html);
  const label = sourceDateLabel(weekStart);
  const selected = weeks.find((week) => week.dateLabel.toLowerCase() === label.toLowerCase());
  if (!selected) {
    return NextResponse.json({
      ok: false,
      error: `Central source did not contain week ${label}`,
      availableWeeks: weeks.map((week) => week.dateLabel),
    }, { status: 502 });
  }

  // The centralized source is the coverage authority for this experiment.
  // This avoids silently dropping a real list when our local calendar is stale
  // (the Aug-17 proof exposed exactly that: Prague was live in the source while
  // the DB still had a stale Tashkent row). DB matching is metadata only.
  const sourceChallengers = selected.tournaments.filter((t) => /^Challenger\s+/i.test(t.level ?? ''));
  const tournaments = sourceChallengers.map((source) => {
    const edition = matchEdition(source, editions.rows);
    return {
      editionId: edition?.edition_id ?? null,
      tournament: edition?.name ?? source.name,
      city: edition?.city ?? source.name,
      startDate: edition ? isoDate(edition.start_date) : weekStart,
      level: source.level,
      sourceName: source.rawName,
      surface: source.surface,
      main: source.main,
      wildCards: source.wildCards,
      qualifying: source.qualifying,
      qualifyingNextIn: source.qualifyingNext,
      released: Boolean(
        source.main.length || source.wildCards.length || source.qualifying.length || source.qualifyingNext.length
      ),
    };
  });

  const matchedToDatabase = tournaments.filter((t) => t.editionId !== null).length;
  const released = tournaments.filter((t) => t.released).length;
  const snapshotJson = JSON.stringify(tournaments);
  const contentHash = createHash('sha256').update(snapshotJson).digest('hex');
  const updatedText = sourceUpdatedText(html);

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
      sourceWeek: selected.sourceWeek,
      changed: false,
      tournaments: tournaments.length,
      released,
      matchedToDatabase,
      databaseCandidates: editions.rows.length,
      sourceUpdatedText: updatedText,
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
    [weekStart, SOURCE_TYPE, CENTRAL_SOURCE_URL, updatedText, contentHash, tournaments.length, snapshotJson]
  );

  return NextResponse.json({
    ok: true,
    weekStart,
    sourceWeek: selected.sourceWeek,
    changed: true,
    tournaments: tournaments.length,
    released,
    matchedToDatabase,
    databaseCandidates: editions.rows.length,
    sourceUpdatedText: updatedText,
    lists: tournaments.map((t) => ({
      tournament: t.tournament,
      sourceName: t.sourceName,
      released: t.released,
      main: t.main.length,
      wildCards: t.wildCards.length,
      qualifying: t.qualifying.length,
      qualifyingNextIn: t.qualifyingNextIn.length,
      databaseMatched: t.editionId !== null,
    })),
  });
}
