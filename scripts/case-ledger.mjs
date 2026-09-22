#!/usr/bin/env node
/**
 * The audit bot's case ledger, from the command line. Run through tsx (it imports src/lib/agent-cases.ts):
 *
 *   npx tsx scripts/case-ledger.mjs sync monday-audit-state.json   # record what an audit run found
 *   npx tsx scripts/case-ledger.mjs status                         # counts and what is open
 *
 * `sync` opens a case per new finding, refreshes known ones, reopens ones that came back, and closes the
 * ones the audit no longer reports. It writes `boss_cases=<n>` to $GITHUB_OUTPUT: how many cases the boss
 * agent has left to work on, so the workflow can skip the boss entirely on a clean day.
 *
 * Needs DATABASE_URL with write access (the audit itself connects read-only; the ledger is a separate step).
 */
import { readFileSync, appendFileSync } from 'node:fs'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(2)
}
if (!/localhost|127\.0\.0\.1/.test(url)) process.env.PGSSLMODE ??= 'no-verify' // Railway's proxy, like the audit

const { pool } = await import('../src/lib/db.ts')
const ledger = await import('../src/lib/agent-cases.ts')
const { syncFindings, casesForBoss, listCases } = ledger.syncFindings ? ledger : ledger.default

const [command, file] = process.argv.slice(2)
try {
  if (command === 'sync') {
    if (!file) throw new Error('usage: case-ledger.mjs sync <state.json>')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    const findings = (state.findings ?? []).map((f) => ({
      key: f.key,
      severity: f.severity === 'critical' ? 'critical' : 'warn',
      title: f.title ?? f.id,
      text: f.text,
      // The audit attaches structured remedy data to some findings (see monday-audit.mjs's `causeItem`
      // and V1); anything else falls back to a plain reference so the case is still identifiable.
      data: f.data ?? { ref: String(f.key).split('|').slice(1).join('|'), mode: state.mode ?? 'full', asOf: state.asOf },
    }))
    const result = await syncFindings({ source: 'audit', ran: state.ran ?? [], verified: state.verified ?? [], findings })
    const work = await casesForBoss()
    console.log(`ledger: ${JSON.stringify(result)}; ${work.length} case(s) for the boss`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `boss_cases=${work.length}\n`)
  } else if (command === 'status') {
    const { counts, cases } = await listCases({ status: ['open', 'in_progress', 'escalated', 'acknowledged'], limit: 100 })
    console.log(JSON.stringify(counts))
    for (const c of cases) console.log(`#${c.id} [${c.status}] ${c.severity} ${c.key} — attempts ${c.attempts}`)
  } else {
    throw new Error('commands: sync <state.json> | status')
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 2
} finally {
  await pool.end()
}
