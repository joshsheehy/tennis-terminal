// One-time coordinate backfill for the Swings map view (phase 1).
//
// Connects via the DATABASE_URL environment variable (same as the app).
// DRY-RUN BY DEFAULT: prints what it would write without touching the
// database. Pass --apply to perform the writes.
//
//   npm run geocode:tournaments                        # dry run (no writes)
//   npm run geocode:tournaments -- --apply             # write coordinates
//   npm run geocode:tournaments -- --apply --year=2026 # one season only
//   npm run geocode:tournaments -- --limit=50          # bound a run
//
// Successful lookups are cached in data/geocode-cache.json so reruns never
// re-query Nominatim for a known city. Failures are written to
// reports/geocode-failures.json for manual resolution — never guessed.

import fs from 'node:fs';
import path from 'node:path';
import { pool } from '@/lib/db';
import { GeocodeResult } from '@/lib/geocode';
import { runGeocodeBackfill } from '@/lib/geocode-backfill';
import { AVAILABLE_SEASONS, isAvailableSeason } from '@/lib/seasons';

const CACHE_FILE = path.join(process.cwd(), 'data', 'geocode-cache.json');
const FAILURE_REPORT_FILE = path.join(process.cwd(), 'reports', 'geocode-failures.json');
const DRY_RUN_PREVIEW_ROWS = 20;

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  if (limitArg && (!Number.isInteger(limit) || limit! <= 0)) {
    throw new Error(`Invalid --limit value: ${limitArg}`);
  }
  const yearArg = argv.find((arg) => arg.startsWith('--year='));
  const year = yearArg ? Number(yearArg.split('=')[1]) : undefined;
  if (yearArg && !isAvailableSeason(year!)) {
    throw new Error(`Unknown season in ${yearArg}; use one of ${AVAILABLE_SEASONS.join(', ')}`);
  }
  return { apply, limit, year };
}

function loadCache(): Map<string, GeocodeResult> {
  if (!fs.existsSync(CACHE_FILE)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, GeocodeResult>;
  return new Map(Object.entries(parsed));
}

function saveCache(cache: Map<string, GeocodeResult>) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const sorted = Object.fromEntries([...cache.entries()].sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function main() {
  const { apply, limit, year } = parseArgs(process.argv.slice(2));
  const cache = loadCache();

  console.log(
    apply
      ? 'Geocoding tournaments (APPLY mode: coordinates will be written)...'
      : 'Geocoding tournaments (dry run: no database writes; pass --apply to write)...'
  );

  const result = await runGeocodeBackfill(pool, {
    dryRun: !apply,
    limit,
    cache,
    years: year ? [year] : undefined,
  });

  saveCache(cache);

  const preview = result.resolved.slice(0, DRY_RUN_PREVIEW_ROWS);
  if (preview.length > 0) {
    console.log(
      `\n${result.dryRun ? 'Would write' : 'Wrote'} (showing ${preview.length} of ${result.resolved.length}):`
    );
    console.table(
      preview.map((row) => ({
        slug: row.slug,
        city: row.city,
        country: row.country ?? '',
        latitude: row.latitude,
        longitude: row.longitude,
        source: row.source,
        resolved_as: row.displayName.slice(0, 60),
      }))
    );
  }

  if (result.failures.length > 0) {
    fs.mkdirSync(path.dirname(FAILURE_REPORT_FILE), { recursive: true });
    fs.writeFileSync(FAILURE_REPORT_FILE, `${JSON.stringify(result.failures, null, 2)}\n`);
    console.log(`\nFailures written to ${path.relative(process.cwd(), FAILURE_REPORT_FILE)}:`);
    for (const failure of result.failures) {
      console.log(`  - ${failure.slug} (${failure.city}, ${failure.country ?? '?'}): ${failure.reason}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  mode:                ${result.dryRun ? 'dry run' : 'apply'}`);
  console.log(`  seasons:             ${result.years.join(', ')}`);
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
