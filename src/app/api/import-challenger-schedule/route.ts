import { NextRequest, NextResponse } from 'next/server';
import slugify from 'slugify';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  startDate: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((v) => v.trim());
}

function getAtpWeek(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (date.getUTCMonth() === 11) return 1;

  const jan7 = new Date(Date.UTC(date.getUTCFullYear(), 0, 7));
  const jan7Day = jan7.getUTCDay();
  const daysBack = jan7Day === 0 ? 6 : jan7Day - 1;
  const firstMonday = new Date(jan7.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const daysSince = Math.floor((date.getTime() - firstMonday.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(1, Math.floor(daysSince / 7) + 1);
}

async function fetchSackmannChallengerList(year: number): Promise<{ totalInCsv: number; challengerCount: number; tournaments: SackmannTournament[] }> {
  const url = `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_${year}.csv`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`JeffSackmann fetch failed: ${res.status} for year ${year}`);

  const text = await res.text();
  const lines = text.split('\n').map((l) => l.replace(/\r/g, ''));
  if (lines.length < 2) throw new Error('CSV appears empty');

  const headers = parseCsvLine(lines[0]);
  const col = (name: string) => headers.indexOf(name);

  const idIdx = col('tourney_id');
  const nameIdx = col('tourney_name');
  const surfaceIdx = col('surface');
  const dateIdx = col('tourney_date');
  const levelIdx = col('tourney_level');

  if ([idIdx, nameIdx, surfaceIdx, dateIdx, levelIdx].some((i) => i === -1)) {
    throw new Error(`Missing expected columns. Headers: ${headers.join(', ')}`);
  }

  let totalInCsv = 0;
  let challengerCount = 0;
  const seen = new Map<string, SackmannTournament>();

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    totalInCsv += 1;

    const cols = parseCsvLine(line);
    const level = cols[levelIdx] ?? '';
    if (level !== 'C') continue;
    challengerCount += 1;

    const tourneyId = cols[idIdx] ?? '';
    if (!tourneyId || seen.has(tourneyId)) continue;

    const codePart = tourneyId.split('-')[1];
    if (!codePart) continue;
    const code = parseInt(codePart, 10);
    if (!Number.isFinite(code) || code <= 0) continue;

    const rawDate = cols[dateIdx] ?? '';
    if (!/^\d{8}$/.test(rawDate)) continue;
    const startDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    seen.set(tourneyId, {
      tourneyId,
      code,
      name: cols[nameIdx] ?? '',
      surface: cols[surfaceIdx] ?? 'Hard',
      startDate,
    });
  }

  return {
    totalInCsv,
    challengerCount,
    tournaments: Array.from(seen.values()).sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
}

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : 2025;

  if (![2024, 2025, 2026].includes(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024, 2025, or 2026' }, { status: 400 });
  }

  try {
    const { totalInCsv, challengerCount, tournaments } = await fetchSackmannChallengerList(year);
    const imported: Array<{ slug: string; name: string; year: number; week: number; code: number; startDate: string }> = [];
    const failed: Array<{ tourneyId: string; code: number; name: string; error: string }> = [];

    for (const t of tournaments) {
      try {
        const editionEntry = CODE_TO_EDITION.get(t.code);

        let slug: string;
        let name: string;
        let city: string;
        let country: string | null;
        let level: string;
        let source: string;

        if (editionEntry) {
          slug = editionEntry.tournament.slug;
          name = editionEntry.tournament.name;
          city = editionEntry.tournament.city;
          country = editionEntry.tournament.country;
          level = editionEntry.edition.level;
          source = editionEntry.edition.source;
        } else {
          name = t.name;
          city = t.name;
          country = null;
          level = 'Challenger';
          source = 'atp_challenger_pdf';
          slug = slugify(`${name}-${city}`, { lower: true, strict: true, trim: true });
        }

        const startDateObj = new Date(`${t.startDate}T00:00:00Z`);
        const isDecember = startDateObj.getUTCMonth() === 11;
        const editionYear = isDecember ? startDateObj.getUTCFullYear() + 1 : year;
        const week = isDecember ? 1 : getAtpWeek(t.startDate);

        const slugifiedName = slugify(name, { lower: true, strict: true, trim: true });
        const sourceUrl = `https://www.atptour.com/en/scores/archive/${slugifiedName}/${t.code}/${year}/results`;

        const tournamentResult = await pool.query<{ id: string }>(
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

        await pool.query(
          `insert into tournament_editions (
             tournament_id, year, week, start_date, end_date, level, surface,
             indoor, source, source_url, status, updated_at
           ) values (
             $1, $2, $3, $4, null, $5, $6,
             false, $7, $8, 'held', now()
           )
           on conflict (tournament_id, year) do update set
             week = excluded.week,
             start_date = excluded.start_date,
             surface = excluded.surface,
             source = excluded.source,
             source_url = excluded.source_url,
             status = 'held',
             updated_at = now()`,
          [tournamentResult.rows[0].id, editionYear, week, t.startDate, level, t.surface, source, sourceUrl]
        );

        imported.push({ slug, name, year: editionYear, week, code: t.code, startDate: t.startDate });
      } catch (err) {
        failed.push({
          tourneyId: t.tourneyId,
          code: t.code,
          name: t.name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      ok: true,
      year,
      totalInCsv,
      challengerCount,
      importedCount: imported.length,
      failedCount: failed.length,
      imported,
      failed,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to import challenger schedule' },
      { status: 500 }
    );
  }
}
