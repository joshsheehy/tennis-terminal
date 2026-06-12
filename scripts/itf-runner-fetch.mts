// Fetches the ITF World Tennis Tour calendar from itftennis.com and writes
// parsed events to a JSON file. Runs on a GitHub runner (itftennis.com's
// Incapsula wall blocks Railway but admits runners); the itf-sync workflow
// then POSTs the file to /api/import-itf-rows.
//
//   npx tsx scripts/itf-runner-fetch.mts 2026 men /tmp/itf-rows.json

import { writeFileSync } from 'node:fs';
import {
  fetchItfCalendarPage,
  isParseFailure,
  parseItfCalendarItem,
  ITF_CIRCUITS,
  type ParsedItfEvent,
} from '../src/lib/itf-calendar';

const year = Number(process.argv[2] ?? new Date().getFullYear());
const circuit = process.argv[3] ?? 'men';
const outPath = process.argv[4] ?? '/tmp/itf-rows.json';

const circuitCode = ITF_CIRCUITS[circuit];
if (!circuitCode) {
  console.error(`unknown circuit "${circuit}" (use ${Object.keys(ITF_CIRCUITS).join('|')})`);
  process.exit(1);
}

const PAGE_SIZE = 100;
const events: ParsedItfEvent[] = [];
const failures = new Map<string, number>();
let skip = 0;
let totalItems: number | null = null;
let pages = 0;

for (;;) {
  const page = await fetchItfCalendarPage(year, circuitCode, skip, PAGE_SIZE);
  pages += 1;
  totalItems = page.totalItems ?? totalItems;
  for (const item of page.items) {
    const result = parseItfCalendarItem(item, year);
    if (isParseFailure(result)) {
      failures.set(result.reason, (failures.get(result.reason) ?? 0) + 1);
    } else {
      events.push(result);
    }
  }
  skip += page.items.length;
  if (page.items.length === 0 || (totalItems !== null && skip >= totalItems)) break;
  if (pages > 40) {
    console.error('aborting: more than 40 pages, pagination looks broken');
    process.exit(1);
  }
}

console.log(`fetched ${pages} pages, ${skip} items (API reports ${totalItems}), parsed ${events.length} events`);
for (const [reason, count] of failures) console.log(`  skipped ${count}x: ${reason}`);
const byLevel = new Map<string, number>();
for (const e of events) byLevel.set(e.level, (byLevel.get(e.level) ?? 0) + 1);
console.log('by level:', Object.fromEntries(byLevel));

if (events.length === 0) {
  console.error('no events parsed — refusing to emit an empty file');
  process.exit(1);
}
// source_url is stripped before POSTing: a body carrying hundreds of
// itftennis.com URLs trips the WAF in front of the app (403).
const rows = events.map((e) => ({ ...e, source_url: null }));
writeFileSync(outPath, JSON.stringify({ year, circuit, rows }));
console.log(`wrote ${rows.length} events to ${outPath}`);
