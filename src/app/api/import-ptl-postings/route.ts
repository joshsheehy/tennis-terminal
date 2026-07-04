import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { EARLIEST_SEASON } from '@/lib/seasons';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { upsertOfficialRow, type OfficialCalendarRow } from '@/lib/official-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Receives season rows scanned OFF-server from ProTennisLive posting headers
// (scripts/scan-ptl-season.mjs on a GitHub runner) and upserts them with the
// same logic the official-calendar import uses. This is the DIRECT-from-ATP
// historical source: PTL is the ATP's own posting system, hosts every event
// that published an entry list (defunct ones included), and its headers carry
// era-correct levels ("Challenger 80" in 2022) that no template copy could.
//
//   POST /api/import-ptl-postings?apply=true
//   { "year": 2022, "rows": [ { "code": 2791, "name": "Bangkok Open I",
//       "city": "Nonthaburi", "country": "Thailand", "startDate": "2022-08-22",
//       "level": "Challenger 50", "surface": "Hard", "indoor": false,
//       "tourLevelHeuristic": false } ] }

const MAX_ROWS = 250;

// Codes are permanent per tournament — a catalogue match by code gives the
// exact identity and level for surviving events (fixes the scanner's
// money-based ATP 250/500 guess, e.g. Rotterdam).
const CATALOGUE_BY_CODE = new Map<number, (typeof ALL_EDITIONS)[0]>();
for (const entry of ALL_EDITIONS) {
  const code = Number(entry.edition.protennislive_code);
  if (!Number.isFinite(code) || code <= 0) continue;
  const existing = CATALOGUE_BY_CODE.get(code);
  if (!existing || entry.edition.year > existing.edition.year) {
    CATALOGUE_BY_CODE.set(code, entry);
  }
}

type IncomingRow = {
  code: number;
  name: string;
  city: string;
  country: string | null;
  startDate: string;
  endDate?: string | null;
  level: string;
  surface: string;
  indoor?: boolean;
  tourLevelHeuristic?: boolean;
};

function validateRow(raw: unknown): { row?: IncomingRow; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'row is not an object' };
  const r = raw as Record<string, unknown>;
  const code = Number(r.code);
  const name = String(r.name ?? '').trim();
  const city = String(r.city ?? '').trim();
  const startDate = String(r.startDate ?? '');
  const level = String(r.level ?? '').trim();
  const surface = String(r.surface ?? 'Hard').trim();
  if (!Number.isInteger(code) || code <= 0) return { error: `bad code "${r.code}"` };
  if (!name) return { error: 'missing name' };
  if (!city) return { error: 'missing city' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: `bad startDate "${r.startDate}"` };
  if (!/^(Challenger \d{2,3}|ATP (250|500|1000))$/.test(level)) return { error: `bad level "${r.level}"` };
  if (!/^(Hard|Clay|Grass|Carpet)$/.test(surface)) return { error: `bad surface "${r.surface}"` };
  return {
    row: {
      code,
      name,
      city,
      country: r.country ? String(r.country).trim() : null,
      startDate,
      endDate: r.endDate ? String(r.endDate) : null,
      level,
      surface,
      indoor: Boolean(r.indoor),
      tourLevelHeuristic: Boolean(r.tourLevelHeuristic),
    },
  };
}

export async function POST(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 });
  }
  const { year, rows } = body as { year?: unknown; rows?: unknown };
  if (!Number.isInteger(year) || (year as number) < EARLIEST_SEASON || (year as number) > 2030) {
    return NextResponse.json(
      { ok: false, error: `year must be an integer ${EARLIEST_SEASON}-2030` },
      { status: 400 }
    );
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json(
      { ok: false, error: `rows must be a non-empty array of <= ${MAX_ROWS}` },
      { status: 400 }
    );
  }

  const invalid: Array<{ index: number; error: string }> = [];
  const upserted = [];
  const failed = [];

  for (let i = 0; i < rows.length; i++) {
    const { row, error } = validateRow(rows[i]);
    if (!row) {
      invalid.push({ index: i, error: error ?? 'invalid' });
      continue;
    }

    // Catalogue-by-code upgrade: surviving events take their canonical
    // identity + level (the scanner's ATP 250/500 money heuristic can't tell
    // those apart; the code can). The level swap only applies when the
    // catalogue entry is itself a tour tier: codes are permanent across tier
    // changes, so a code whose latest edition is a Challenger (Newport after
    // its ATP years) must not stamp that level onto an era when the posting
    // header said TOTAL FINANCIAL COMMITMENT — i.e. it was on Tour.
    const catalogue = CATALOGUE_BY_CODE.get(row.code);
    const name = catalogue?.tournament.name ?? row.name;
    const city = catalogue?.tournament.city ?? row.city;
    const country = catalogue?.tournament.country ?? row.country;
    const catalogueTourLevel =
      catalogue && /^ATP \d+/.test(catalogue.edition.level) ? catalogue.edition.level : null;
    const level = row.tourLevelHeuristic && catalogueTourLevel ? catalogueTourLevel : row.level;

    const official: OfficialCalendarRow = {
      name,
      city,
      country,
      week: 1, // upsertOfficialRow recomputes from startDate; this is the fallback
      startDate: row.startDate,
      level,
      surface: row.surface,
      indoor: row.indoor ?? false,
      sourcePdfUrl: `https://www.protennislive.com/posting/${year}/${row.code}/mds.pdf`,
    };
    try {
      upserted.push(await upsertOfficialRow(official, year as number, !apply));
    } catch (err) {
      failed.push({
        name,
        code: row.code,
        startDate: row.startDate,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (apply && upserted.length > 0) {
    try {
      revalidateTag('schedule');
    } catch {
      // revalidateTag can throw outside the cache runtime; safe to swallow.
    }
  }

  const newlyAdded = upserted
    .filter((row) => row.isNew === true)
    .map((row) => ({ slug: row.slug, name: row.name, year: row.year, week: row.week, level: row.level }));

  return NextResponse.json({
    ok: failed.length === 0 && invalid.length === 0,
    apply,
    year,
    received: rows.length,
    upsertedCount: upserted.length,
    newlyAddedCount: newlyAdded.length,
    newlyAdded: newlyAdded.slice(0, 40),
    failedCount: failed.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 10),
    failed: failed.slice(0, 10),
    sampleUpserted: upserted.slice(0, 5),
    message: apply ? 'Rows upserted.' : 'Dry run. Append ?apply=true to write.',
  });
}
