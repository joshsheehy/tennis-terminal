import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { EARLIEST_SEASON } from '@/lib/seasons';
import { pool } from '@/lib/db';
import {
  cleanName,
  deriveCity,
  DISTINCT_EVENT_MIN_DAYS,
  normalizeSurface,
  upsertOfficialRow,
  COUNTRY_BY_ATP_CODE,
  type OfficialCalendarRow,
} from '@/lib/official-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Receives official challenger-calendar rows that were parsed OFF-server
// (the calendar-diagnosis workflow downloads + parses the PDF on a GitHub
// runner, where that work is cheap and reliable) and upserts them with the
// exact same logic sync-official-calendar uses. Keeps the production web
// process out of the PDF-fetch/parse business, which proved flaky there.
//
//   POST /api/import-official-rows?apply=true
//   { "year": 2025,
//     "sourcePdfUrl": "https://www.atptour.com/.../....pdf",
//     "rows": [ { "week": 28, "startDate": "2025-07-07", "name": "Newport, RI",
//                 "countryCode": "USA", "level": "125", "surfaceCode": "G" } ] }

const MAX_ROWS = 250;

type IncomingRow = {
  week: number;
  startDate: string;
  name: string;
  countryCode?: string;
  level: string;
  surfaceCode?: string;
};

function validateRow(raw: unknown): { row?: IncomingRow; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'row is not an object' };
  const r = raw as Record<string, unknown>;
  const week = Number(r.week);
  const startDate = String(r.startDate ?? '');
  const name = String(r.name ?? '').trim();
  const level = String(r.level ?? '').replace(/^Challenger\s+/i, '');
  if (!Number.isInteger(week) || week < 1 || week > 53) return { error: `bad week "${r.week}"` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: `bad startDate "${r.startDate}"` };
  if (!name) return { error: 'missing name' };
  if (!/^(50|75|100|125|175)$/.test(level)) return { error: `bad level "${r.level}"` };
  return {
    row: {
      week,
      startDate,
      name,
      countryCode: r.countryCode ? String(r.countryCode).toUpperCase() : undefined,
      level,
      surfaceCode: r.surfaceCode ? String(r.surfaceCode) : undefined,
    },
  };
}

export async function POST(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 });
  }
  const { year, sourcePdfUrl, rows } = body as { year?: unknown; sourcePdfUrl?: unknown; rows?: unknown };
  if (!Number.isInteger(year) || (year as number) < EARLIEST_SEASON || (year as number) > 2030) {
    return NextResponse.json({ ok: false, error: 'year must be an integer 2024-2030' }, { status: 400 });
  }
  // Two official hosts publish the challenger calendar: atptour.com (laggy,
  // bot-blocked from datacenters) and rsc.atppz.com (ATP Player Zone — the
  // fresher combined calendar the server-side sync itself prefers). Rejecting
  // Player Zone URLs here silently broke the runner-parsed import path.
  if (
    typeof sourcePdfUrl !== 'string' ||
    !/^https:\/\/(www\.atptour\.com|rsc\.atppz\.com)\/.+\.pdf/i.test(sourcePdfUrl)
  ) {
    return NextResponse.json(
      { ok: false, error: 'sourcePdfUrl must be an atptour.com or rsc.atppz.com PDF URL' },
      { status: 400 }
    );
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: `rows must be a non-empty array of <= ${MAX_ROWS}` }, { status: 400 });
  }

  // { ..., "cancelled": true }: these rows are marked "Cancelled"/"Postponed"
  // in the PDF. Hide the edition already on the site for each (same slug the
  // upsert would pick, start date within two weeks) instead of upserting it.
  // Before this, a cancellation only disappeared once someone added it to
  // cancelled-editions.ts by hand -- Alicante (Torrevieja) and Nova Lima sat
  // on the schedule for weeks after the calendar marked them cancelled.
  if ((body as { cancelled?: unknown }).cancelled === true) {
    const hidden: Array<{ slug: string; year: number; startDate: string }> = [];
    const notFound: Array<{ name: string; startDate: string }> = [];
    for (const raw of rows) {
      const { row } = validateRow(raw);
      if (!row) continue;
      const name = cleanName(row.name);
      const { surface, indoor } = normalizeSurface(row.surfaceCode ?? 'H');
      const resolved = await upsertOfficialRow(
        {
          name,
          city: deriveCity(name),
          country: row.countryCode ? COUNTRY_BY_ATP_CODE[row.countryCode] ?? row.countryCode : null,
          week: row.week,
          startDate: row.startDate,
          level: `Challenger ${row.level}`,
          surface,
          indoor,
          sourcePdfUrl,
        },
        year as number,
        true
      );
      const match = `t.slug = $1
           and te.year = $2
           and te.status = 'held'
           and te.level not ilike 'ITF%'
           and abs(te.start_date - $3::date) < ${DISTINCT_EVENT_MIN_DAYS}`;
      const result = await pool.query<{ slug: string; year: number }>(
        apply
          ? `update tournament_editions te
             set status = 'not_held', updated_at = now()
             from tournaments t
             where te.tournament_id = t.id and ${match}
             returning t.slug, te.year`
          : `select t.slug, te.year from tournament_editions te
             join tournaments t on t.id = te.tournament_id
             where ${match}`,
        [resolved.slug, resolved.year, row.startDate]
      );
      if (result.rows.length) hidden.push({ slug: resolved.slug, year: resolved.year, startDate: row.startDate });
      else notFound.push({ name, startDate: row.startDate });
    }
    if (apply && hidden.length) {
      try {
        revalidateTag('schedule');
      } catch {
        // revalidateTag can throw outside the cache runtime; safe to swallow.
      }
    }
    return NextResponse.json({ ok: true, apply, cancelled: true, hiddenCount: hidden.length, hidden, alreadyHiddenOrMissing: notFound });
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
    const name = cleanName(row.name);
    const { surface, indoor } = normalizeSurface(row.surfaceCode ?? 'H');
    const official: OfficialCalendarRow = {
      name,
      city: deriveCity(name),
      country: row.countryCode ? COUNTRY_BY_ATP_CODE[row.countryCode] ?? row.countryCode : null,
      week: row.week,
      startDate: row.startDate,
      level: `Challenger ${row.level}`,
      surface,
      indoor,
      sourcePdfUrl,
    };
    try {
      upserted.push(await upsertOfficialRow(official, year as number, !apply));
    } catch (err) {
      failed.push({ name, startDate: row.startDate, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // New tournaments won't show on the schedule until the cached query is
  // invalidated — do it now instead of waiting out the 5-minute TTL.
  if (apply && upserted.length > 0) {
    try {
      revalidateTag('schedule');
    } catch {
      // revalidateTag can throw outside the cache runtime; safe to swallow.
    }
  }

  // Genuinely-new editions inserted on this run (isNew=true), for the
  // workflow log — mirrors sync-official-calendar's newlyAdded reporting.
  const newlyAdded = upserted
    .filter((row) => row.isNew === true)
    .map((row) => ({ slug: row.slug, name: row.name, year: row.year, week: row.week, level: row.level }));

  return NextResponse.json({
    ok: failed.length === 0 && invalid.length === 0,
    apply,
    year,
    received: rows.length,
    newlyAddedCount: newlyAdded.length,
    newlyAdded: newlyAdded.slice(0, 40),
    upsertedCount: upserted.length,
    failedCount: failed.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 10),
    failed: failed.slice(0, 10),
    sampleUpserted: upserted.slice(0, 5),
    message: apply ? 'Rows upserted.' : 'Dry run. Append ?apply=true to write.',
  });
}
