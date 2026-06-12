// Swing detection runner (phase 2). Connects via DATABASE_URL like the app.
// DRY-RUN BY DEFAULT: prints the detected swings without writing. --apply
// replaces the year's rows in the additive swings tables.
//
//   npm run swings:recompute                          # dry run, all seasons
//   npm run swings:recompute -- --year=2026           # one season
//   npm run swings:recompute -- --apply --year=2026   # persist
//
// Rerun whenever the calendar updates; the swings-recompute.yml workflow does
// this nightly against production once it is on the default branch.

import { pool } from '@/lib/db';
import { AVAILABLE_SEASONS, isAvailableSeason } from '@/lib/seasons';
import { describeSwing, recomputeSwingsForYear } from '@/lib/swings-data';

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const yearArg = argv.find((arg) => arg.startsWith('--year='));
  const year = yearArg ? Number(yearArg.split('=')[1]) : undefined;
  if (yearArg && !isAvailableSeason(year!)) {
    throw new Error(`Unknown season in ${yearArg}; use one of ${AVAILABLE_SEASONS.join(', ')}`);
  }
  return { apply, year };
}

async function main() {
  const { apply, year } = parseArgs(process.argv.slice(2));
  const years = year ? [year] : [...AVAILABLE_SEASONS].sort();

  for (const target of years) {
    const summary = await recomputeSwingsForYear(pool, target, { persist: apply });
    console.log(
      `\n=== ${target}: ${summary.swings.length} swings from ${summary.eventCount} events` +
        `${apply ? ' (persisted)' : ' (dry run)'} ===`
    );
    for (const swing of summary.swings) {
      const d = describeSwing(swing);
      console.log(
        `\n${d.label} — ${d.weeks} (${d.totalWeeks} wk) · ${d.tierMix} · ` +
          `${d.surfaceConsistent ? d.surfaces[0] : `mixed: ${d.surfaces.join('/')}`}`
      );
      for (const line of d.itinerary) console.log(`  ${line}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
