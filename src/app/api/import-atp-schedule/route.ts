import { isAvailableSeason } from '@/lib/seasons';
import { NextRequest, NextResponse } from 'next/server';
import slugify from 'slugify';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from '@/lib/atp-week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeName(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

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


function getBestEditionForCode(code: number, requestedYear: number) {
  const matches = ALL_EDITIONS.filter((e) => Number(e.edition.protennislive_code) === code);
  if (matches.length === 0) return null;
  return (
    matches.find((e) => e.edition.year === requestedYear) ??
    matches.find((e) => e.edition.year === 2026) ??
    [...matches].sort((a, b) => b.edition.year - a.edition.year)[0]
  );
}

type SackmannTournament = {
  tourneyId: string;
  code: number;
  name: string;
  surface: string;
  startDate: string;
  level: 'A' | 'M';
};

async function fetchSackmannAtpTourList(year: number): Promise<{ totalInCsv: number; atpTourCount: number; tournaments: SackmannTournament[] }> {
  const url = `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_${year}.csv`;
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
  let atpTourCount = 0;
  const seen = new Map<string, SackmannTournament>();

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    totalInCsv += 1;
    const cols = parseCsvLine(line);
    const level = cols[levelIdx] ?? '';
    if (level !== 'A' && level !== 'M') continue;
    atpTourCount += 1;

    const tourneyId = cols[idIdx] ?? '';
    if (!tourneyId || seen.has(tourneyId)) continue;
    const codePart = tourneyId.split('-')[1];
    if (!codePart) continue;
    const code = parseInt(codePart, 10);
    if (!Number.isFinite(code) || code <= 0) continue;

    const rawDate = cols[dateIdx] ?? '';
    if (!/^\d{8}$/.test(rawDate)) continue;
    const startDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    seen.set(tourneyId, { tourneyId, code, name: cols[nameIdx] ?? '', surface: cols[surfaceIdx] ?? 'Hard', startDate, level });
  }

  return { totalInCsv, atpTourCount, tournaments: Array.from(seen.values()).sort((a, b) => a.startDate.localeCompare(b.startDate)) };
}

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : 2025;
  if (!isAvailableSeason(year)) {
    return NextResponse.json({ ok: false, error: 'year must be 2024, 2025, or 2026' }, { status: 400 });
  }

  try {
    const { totalInCsv, atpTourCount, tournaments } = await fetchSackmannAtpTourList(year);
    const imported: Array<{ slug: string; name: string; year: number; week: number; code: number; startDate: string }> = [];
    const failed: Array<{ tourneyId: string; code: number; name: string; error: string }> = [];

    for (const t of tournaments) {
      if (normalizeName(t.name) === 'united cup') continue;
      try {
        const editionEntry = getBestEditionForCode(t.code, year);
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
          level = t.level === 'M' ? 'ATP 1000' : 'ATP 250';
          source = 'atp_tour_pdf';
          slug = slugify(`${name}-${city}`, { lower: true, strict: true, trim: true });
        }

        const editionYear = getAtpEditionYearForStartDate(t.startDate, year);
        const week = getAtpWeekForSeason(t.startDate, editionYear) ?? 1;

        const slugifiedName = slugify(name, { lower: true, strict: true, trim: true });
        const sourceUrl = `https://www.atptour.com/en/scores/archive/${slugifiedName}/${t.code}/${year}/results`;

        const tournamentResult = await pool.query<{ id: string }>(
          `insert into tournaments (slug, name, city, country, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (slug) do update set name = excluded.name, city = excluded.city, country = excluded.country, updated_at = now()
           returning id`,
          [slug, name, city, country]
        );

        await pool.query(
          `insert into tournament_editions (tournament_id, year, week, start_date, end_date, level, surface, indoor, source, source_url, status, updated_at)
           values ($1, $2, $3, $4, null, $5, $6, false, $7, $8, 'held', now())
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
        failed.push({ tourneyId: t.tourneyId, code: t.code, name: t.name, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return NextResponse.json({ ok: true, year, totalInCsv, atpTourCount, importedCount: imported.length, failedCount: failed.length, imported, failed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to import ATP schedule' }, { status: 500 });
  }
}
