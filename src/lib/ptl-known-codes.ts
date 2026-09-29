import { pool } from './db';
import { ALL_EDITIONS } from './tournament-data';

// ProTennisLive codes we already have for a season — the static catalogue
// plus whatever the DB has picked up in te.source_url / cutoff_snapshots
// source_notes. Anything in this set has a known code-to-tournament mapping
// already; probing it again against a host that rate-limits after a few
// dozen requests (see scan-ptl-season.mjs) spends budget for zero new
// information. Shared by /api/discover-codes (its auto-anchor) and
// /api/known-ptl-codes (what scan-ptl-season.mjs skips before probing).
export async function getKnownCodesForYear(year: number): Promise<number[]> {
  const codes = new Set<number>();
  for (const item of ALL_EDITIONS) {
    if (item.edition.year === year && item.edition.protennislive_code) {
      const n = Number(item.edition.protennislive_code);
      if (Number.isFinite(n)) codes.add(n);
    }
  }
  const result = await pool.query<{ code: string }>(
    `
    select distinct code from (
      select (regexp_match(te.source_url, '/posting/\\d+/(\\d+)/'))[1] as code
      from tournament_editions te
      where te.year = $1 and te.source_url ~ '/posting/\\d+/\\d+/'
      union all
      select (regexp_match(cs.source_notes, '/posting/\\d+/(\\d+)/'))[1] as code
      from cutoff_snapshots cs
      join tournament_editions te on te.id = cs.tournament_edition_id
      where te.year = $1 and cs.source_notes ~ '/posting/\\d+/\\d+/'
    ) x where code is not null
    `,
    [year]
  );
  for (const row of result.rows) {
    const n = Number(row.code);
    if (Number.isFinite(n)) codes.add(n);
  }
  return Array.from(codes);
}
