import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { parseAcceptanceListPdfBuffer } from '@/lib/acceptance-list-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DueSource = {
  id: string;
  source_url: string;
  etag: string | null;
  last_modified: string | null;
  last_content_hash: string | null;
  start_date: string | Date;
};

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? value : null;
}

function nextCheckAt(startDate: string | Date): Date {
  const start = startDate instanceof Date ? startDate : new Date(`${startDate}T12:00:00Z`);
  const now = new Date();
  const days = Math.ceil((start.getTime() - now.getTime()) / 86_400_000);
  const hours = days <= 21 ? 6 : 24;
  return new Date(now.getTime() + hours * 3_600_000);
}

async function fetchSource(source: DueSource) {
  const headers: Record<string, string> = {
    accept: 'application/pdf,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; TennisCuts/1.0; public entry-list sync)',
  };
  if (source.etag) headers['if-none-match'] = source.etag;
  if (source.last_modified) headers['if-modified-since'] = source.last_modified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(source.source_url, {
      headers,
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? '12'), 1), 30);

  // Only known public sources are checked here. Source discovery is deliberately
  // separate so the cheap recurring sync never searches/crawls the web.
  const due = await pool.query<DueSource>(
    `
    select als.id, als.source_url, als.etag, als.last_modified,
           als.last_content_hash, te.start_date
    from acceptance_list_sources als
    join tournament_editions te on te.id = als.tournament_edition_id
    where als.active = true
      and te.status = 'held'
      and te.start_date >= current_date
      and te.start_date <= current_date + interval '35 days'
      and (als.next_check_at is null or als.next_check_at <= now())
    order by coalesce(als.next_check_at, '-infinity'::timestamptz), te.start_date
    limit $1
    `,
    [limit]
  );

  const results: Array<Record<string, unknown>> = [];

  // Intentionally sequential. The due set is tiny and this avoids bursty traffic
  // against tournament/federation sites while keeping Railway memory/CPU low.
  for (const source of due.rows) {
    const nextCheck = nextCheckAt(source.start_date);
    try {
      const response = await fetchSource(source);

      if (response.status === 304) {
        await pool.query(
          `update acceptance_list_sources
           set last_checked_at = now(), next_check_at = $2,
               failure_count = 0, last_error = null, updated_at = now()
           where id = $1`,
          [source.id, nextCheck]
        );
        results.push({ sourceId: source.id, status: 'unchanged_304' });
        continue;
      }

      if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('source did not return a PDF');
      }

      const hash = createHash('sha256').update(buffer).digest('hex');
      const etag = response.headers.get('etag');
      const lastModified = response.headers.get('last-modified');

      // Some hosts omit ETag/Last-Modified. Hashing is cheap; PDF parsing is not
      // needed unless the bytes actually changed.
      if (hash === source.last_content_hash) {
        await pool.query(
          `update acceptance_list_sources
           set etag = coalesce($2, etag), last_modified = coalesce($3, last_modified),
               last_checked_at = now(), next_check_at = $4,
               failure_count = 0, last_error = null, updated_at = now()
           where id = $1`,
          [source.id, etag, lastModified, nextCheck]
        );
        results.push({ sourceId: source.id, status: 'unchanged_hash' });
        continue;
      }

      const parsed = await parseAcceptanceListPdfBuffer(buffer);

      await pool.query('begin');
      try {
        await pool.query(
          `insert into acceptance_list_snapshots (
             source_id, list_date, ranking_date, original_cutoff_rank,
             parse_status, entry_count, entries, content_hash
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           on conflict (source_id, content_hash) do nothing`,
          [
            source.id,
            isoDate(parsed.list_date),
            isoDate(parsed.ranking_date),
            parsed.original_cutoff_rank,
            parsed.parse_status,
            parsed.entries.length,
            JSON.stringify(parsed.entries),
            hash,
          ]
        );

        await pool.query(
          `update acceptance_list_sources
           set etag = $2, last_modified = $3, last_content_hash = $4,
               last_checked_at = now(), last_changed_at = now(), next_check_at = $5,
               failure_count = 0, last_error = null, updated_at = now()
           where id = $1`,
          [source.id, etag, lastModified, hash, nextCheck]
        );
        await pool.query('commit');
      } catch (error) {
        await pool.query('rollback');
        throw error;
      }

      results.push({
        sourceId: source.id,
        status: 'changed',
        parseStatus: parsed.parse_status,
        cutoff: parsed.original_cutoff_rank,
        entries: parsed.entries.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `update acceptance_list_sources
         set last_checked_at = now(), next_check_at = $2,
             failure_count = failure_count + 1, last_error = left($3, 1000), updated_at = now()
         where id = $1`,
        [source.id, nextCheck, message]
      );
      results.push({ sourceId: source.id, status: 'error', error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: due.rows.length,
    changed: results.filter((row) => row.status === 'changed').length,
    results,
  });
}
