// Country backfill (Swings): fills tournaments.country where NULL. Connects
// via DATABASE_URL like the app. DRY-RUN BY DEFAULT — pass --apply to write.
//
//   npm run backfill:countries               # dry run, no writes
//   npm run backfill:countries -- --apply    # write missing countries
//   npm run backfill:countries -- --limit=50 # bound a run
//
// Pass 1 copies a country from another tournament sharing the same city;
// pass 2 reverse-geocodes coordinates via Nominatim (1 req/s). Existing
// country values are never overwritten. Failures are reported, not guessed.

import fs from 'node:fs';
import path from 'node:path';
import { pool } from '@/lib/db';
import { runCountryBackfill } from '@/lib/country-backfill';

const FAILURE_REPORT_FILE = path.join(process.cwd(), 'reports', 'country-failures.json');
const PREVIEW_ROWS = 30;

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  if (limitArg && (!Number.isInteger(limit) || limit! <= 0)) {
    throw new Error(`Invalid --limit value: ${limitArg}`);
  }
  return { apply, limit };
}

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));
  console.log(
    apply
      ? 'Backfilling tournament countries (APPLY mode: writing)...'
      : 'Backfilling tournament countries (dry run: no writes; pass --apply to write)...'
  );

  const result = await runCountryBackfill(pool, { dryRun: !apply, limit });

  const preview = result.resolved.slice(0, PREVIEW_ROWS);
  if (preview.length > 0) {
    console.log(`\n${result.dryRun ? 'Would write' : 'Wrote'} (showing ${preview.length} of ${result.resolved.length}):`);
    console.table(
      preview.map((row) => ({
        slug: row.slug,
        city: row.city,
        country: row.country,
        source: row.source,
      }))
    );
  }

  if (result.failures.length > 0) {
    fs.mkdirSync(path.dirname(FAILURE_REPORT_FILE), { recursive: true });
    fs.writeFileSync(FAILURE_REPORT_FILE, `${JSON.stringify(result.failures, null, 2)}\n`);
    console.log(`\n${result.failures.length} failures written to ${path.relative(process.cwd(), FAILURE_REPORT_FILE)}`);
  }

  console.log('\nSummary:');
  console.log(`  mode:                ${result.dryRun ? 'dry run' : 'apply'}`);
  console.log(`  missing before run:  ${result.totalMissing}`);
  console.log(`  processed this run:  ${result.processed}`);
  console.log(`  resolved:            ${result.resolved.length}`);
  console.log(`  failed:              ${result.failures.length}`);
  console.log(`  written:             ${result.written}`);
  console.log(`  still missing:       ${result.remaining}`);
  console.log(`  Nominatim requests:  ${result.nominatimRequests}`);
  if (result.rateLimited) {
    console.log('  NOTE: Nominatim rate-limited the run; rerun later to finish the rest.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
