#!/usr/bin/env node
/**
 * TennisCuts Monday Audit — integrity + health check for tenniscuts.com.
 *
 * Answers three questions:
 *   1. Is every cut that SHOULD exist by now actually in the database?
 *   2. Is any stored data impossible, duplicated, or self-contradictory?
 *   3. Are the pipelines, the alert emails and the site itself healthy?
 *
 * Run through tsx: it imports the app's own deadline, anomaly and ATP-week rules
 * from src/lib so the audit cannot drift from what the app itself believes.
 *
 *   npx tsx scripts/monday-audit.mjs --dry-run            # print the report, send nothing
 *   npx tsx scripts/monday-audit.mjs                      # report + Telegram (if configured)
 *   npx tsx scripts/monday-audit.mjs --only=health        # pipelines, alerts and site only (daily)
 *   npx tsx scripts/monday-audit.mjs --weeks=3            # widen the coverage window
 *   npx tsx scripts/monday-audit.mjs --lead=0             # a cut is due this many days BEFORE the event starts
 *   npx tsx scripts/monday-audit.mjs --grace=5            # ...and never sooner than this many days after the entry deadline
 *   npx tsx scripts/monday-audit.mjs --as-of=2026-07-06   # replay as if run on that date
 *   npx tsx scripts/monday-audit.mjs --previous=state.json  # diff against an earlier run's state
 *   npx tsx scripts/monday-audit.mjs --emit-known         # write current findings into the acknowledgements file
 *   npx tsx scripts/monday-audit.mjs --skip-site          # database checks only
 *
 * ACKNOWLEDGING KNOWN GAPS
 *   Some events can never get a cut (no ProTennisLive code, sheet never published).
 *   List them in scripts/monday-audit-known.json so they stop failing the run:
 *     { "acknowledged": [ { "key": "A2|some-slug@2026", "until": "2026-10-31", "reason": "no PTL code" } ] }
 *   An acknowledgement EXPIRES on its `until` date and the finding comes back, so nothing is
 *   muted forever. --emit-known writes scripts/monday-audit-known.json itself (it keeps the
 *   still-valid acknowledgements and adds every current finding for 28 days) to baseline a
 *   noisy first run. Review the file, delete the entries you actually want to fix, commit it.
 *   Keep DATABASE_URL in a file outside the repo and pass it with tsx --env-file=<path>.
 *
 * Env:
 *   DATABASE_URL        required  Postgres URL (Railway *public* URL from CI; read-only is enough)
 *   SITE_URL            optional  default https://tenniscuts.com
 *   TELEGRAM_BOT_TOKEN  optional  create a bot with @BotFather; with TELEGRAM_CHAT_ID sends the summary
 *   TELEGRAM_CHAT_ID    optional  message the bot, then open api.telegram.org/bot<TOKEN>/getUpdates
 *   GITHUB_STEP_SUMMARY, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID   set by GitHub Actions
 *
 * Exit code 1 when any un-acknowledged CRITICAL fires, so a scheduled run goes red and GitHub emails you.
 * Exit code 2 when the audit itself could not run.
 */

import pg from 'pg'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  categoryForLevel,
  deadlinesForEdition,
  isGrandSlamQualifyingLevel,
  mondayOfWeekUtc,
} from '../src/lib/entry-deadlines.ts'
import { ANOMALY_TAG, minPlausibleRank } from '../src/lib/cutoff-anomaly.ts'
import { getAtpWeekForSeason } from '../src/lib/atp-week.ts'

// ───────────────────────────────────────────────────────────────────────────
// CONFIG
// ───────────────────────────────────────────────────────────────────────────

const SITE = (process.env.SITE_URL || 'https://tenniscuts.com').replace(/\/$/, '')
const ARGS = process.argv.slice(2)
const FLAG = (n) => ARGS.includes(`--${n}`)
const OPT = (n, d) => ARGS.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d

const DRY_RUN = FLAG('dry-run')
const EMIT_KNOWN = FLAG('emit-known')
const SKIP_SITE = FLAG('skip-site') || EMIT_KNOWN
const HEALTH_ONLY = OPT('only') === 'health'
const COVERAGE_WEEKS = parseInt(OPT('weeks', '2'), 10) // current week + N-1 ahead
// A cut can only exist once its entry list is posted, which is after the deadline.
const GRACE_DAYS = Number(OPT('grace', '3'))
// In practice cuts are stored around the draw, not days after the entry deadline (in the first
// production run last week's events had their cuts and next week's had none), so a cut is only
// "due" from LEAD_DAYS before the event starts (negative = allow that long after it starts).
// Nothing in the schema records when a number first arrived, so this cannot be measured:
// tune it from what the Monday report flags. --lead=-1 gives an event until the end of its first day.
const LEAD_DAYS = Number(OPT('lead', '0'))
const AS_OF = OPT('as-of') ? new Date(`${OPT('as-of')}T13:00:00Z`) : new Date()
const KNOWN_FILE = OPT('known', fileURLToPath(new URL('./monday-audit-known.json', import.meta.url)))
const PREVIOUS_FILE = OPT('previous')
const ACK_DAYS = 28 // how long --emit-known acknowledgements last

// Upper plausibility bounds. The lower bounds come from the app's own minPlausibleRank.
const MAX_CUT = { singles: 2500, doubles: 6000 }
const MAX_CUT_ITF = { singles: 4000, doubles: 6000 } // ITF qualifying cuts of 2500-2700 are normal

// Checks that still run in --only=health mode.
const HEALTH_CHECKS = new Set(['B1', 'B5', 'E1', 'D1', 'D3'])

// Pipelines with a known cadence, and how long silence is tolerated before it is suspicious.
// Each is skipped quietly if its table does not exist in this database.
const FRESHNESS = [
  { name: 'Public entry-list sync', table: 'entry_list_source_status', column: 'last_checked_at', maxHours: 48, cadence: 'hourly' },
  { name: 'Swings recompute', table: 'swings', column: 'computed_at', maxHours: 72, cadence: 'daily' },
]

const SLOW_MS = 8000
const MS_DAY = 86400000
const COVERAGE_CATS = new Set(['atp', 'challenger', 'grandslam'])
const ICON = { critical: '🔴', warn: '🟡', info: '⚪' }

const RUN_URL =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null

// ───────────────────────────────────────────────────────────────────────────
// DATES
// ───────────────────────────────────────────────────────────────────────────

const iso = (d) => d.toISOString().slice(0, 10)
const dayStart = (s) => new Date(`${s}T00:00:00Z`)
const addDays = (d, n) => new Date(d.getTime() + n * MS_DAY)

const TODAY = new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth(), AS_OF.getUTCDate()))
const WEEK_START = mondayOfWeekUtc(TODAY)
const WINDOW_END = addDays(WEEK_START, 7 * COVERAGE_WEEKS)
const RECENT_START = addDays(WEEK_START, -7) // last week's events still owe us a cut

// ───────────────────────────────────────────────────────────────────────────
// DATA
// ───────────────────────────────────────────────────────────────────────────

/**
 * One row per held edition, with its cuts pivoted out of cutoff_snapshots.
 * cutoff_snapshots is unique on (edition, event_type, draw_type) and re-imports
 * UPDATE in place, so updated_at is the "last written" signal. created_at is NOT
 * when a number arrived: empty rows are created in bulk weeks ahead of the event.
 * A doubles cut is any of three columns: the Challenger advance/onsite cuts
 * live apart from last_direct_acceptance_rank (mirrors /api/missing-cuts-report).
 */
async function loadEditions(client) {
  const draw = (e, d) => `FILTER (WHERE cs.event_type = '${e}' AND cs.draw_type = '${d}')`
  const { rows } = await client.query(
    `SELECT te.id AS edition_id, t.slug, t.name, t.city, t.country, t.latitude, t.longitude,
            te.year, te.week, te.start_date::text AS start_date, te.level, te.singles_draw_size,
            max(cs.last_direct_acceptance_rank) ${draw('singles', 'main')} AS md_cut,
            max(cs.last_direct_acceptance_rank) ${draw('singles', 'qualifying')} AS q_cut,
            max(cs.last_direct_acceptance_rank) ${draw('doubles', 'main')} AS d_rank,
            max(cs.challenger_doubles_advanced_cut_rank) ${draw('doubles', 'main')} AS d_adv,
            max(cs.challenger_doubles_onsite_cut_rank) ${draw('doubles', 'main')} AS d_onsite,
            max(cs.updated_at) ${draw('singles', 'main')} AS md_written,
            max(cs.updated_at) ${draw('singles', 'qualifying')} AS q_written,
            max(cs.updated_at) ${draw('doubles', 'main')} AS d_written,
            coalesce(bool_or(cs.last_direct_acceptance_rank IS NULL
                             AND cs.source_notes LIKE $2), false) AS rejected
     FROM tournament_editions te
     JOIN tournaments t ON t.id = te.tournament_id
     LEFT JOIN cutoff_snapshots cs ON cs.tournament_edition_id = te.id
     WHERE te.status = 'held' AND te.start_date IS NOT NULL AND te.start_date >= $1::date
     GROUP BY te.id, t.id
     ORDER BY te.start_date, t.name`,
    [iso(addDays(TODAY, -400)), `%${ANOMALY_TAG}%`]
  )

  for (const r of rows) {
    r.start = dayStart(r.start_date)
    r.cat = categoryForLevel(r.level)
    r.d_cut = r.d_rank ?? r.d_adv ?? r.d_onsite
    r.draws = expectedDraws(r)
  }
  return rows
}

const HAS = {
  singles_main: (r) => r.md_cut != null,
  singles_qualifying: (r) => r.q_cut != null,
  doubles_main: (r) => r.d_cut != null,
}
const WRITTEN = { singles_main: 'md_written', singles_qualifying: 'q_written', doubles_main: 'd_written' }
const DRAW_LABEL = { singles_main: 'singles main', singles_qualifying: 'singles qualifying', doubles_main: 'doubles main' }

/**
 * The draws an edition should carry a cut for, each with the moment its entry
 * list closes. Mirrors /api/missing-cuts-report: a Slam has singles + doubles
 * main only, "<Slam> Qualifying" is its own entry with singles qualifying only,
 * everything else has singles main + qualifying + doubles main. ITF is not
 * covered (the app's own report excludes it too).
 */
function expectedDraws(r) {
  if (!COVERAGE_CATS.has(r.cat)) return []
  const dueBy = (deadline) =>
    new Date(Math.max(deadline.getTime() + GRACE_DAYS * MS_DAY, r.start.getTime() - LEAD_DAYS * MS_DAY))
  if (isGrandSlamQualifyingLevel(r.level)) {
    // Qualifying closes 28 days before the MAIN draw Monday; this entry sits a week earlier.
    const deadline = addDays(mondayOfWeekUtc(r.start), -21)
    return [{ draw: 'singles_qualifying', deadline, due: dueBy(deadline) }]
  }
  const byKind = Object.fromEntries(deadlinesForEdition(r).map((d) => [d.kind, new Date(d.deadlineAtIso)]))
  const out = [{ draw: 'singles_main', deadline: byKind.main }]
  if (r.cat !== 'grandslam') out.push({ draw: 'singles_qualifying', deadline: byKind.qualifying })
  out.push({ draw: 'doubles_main', deadline: byKind.doubles })
  return out.filter((d) => d.deadline).map((d) => ({ ...d, due: dueBy(d.deadline) }))
}

const overdue = (d) => AS_OF.getTime() > d.due.getTime()
const label = (r) => `${r.name} · ${r.level} · ${r.start_date}`
const withRejected = (r, s) => (r.rejected ? `${s} · parsed cut was rejected as anomalous` : s)
const weekKey = (r) => iso(mondayOfWeekUtc(r.start))
const ek = (r) => `${r.slug}@${r.year}` // stable across date edits, unique per edition
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 100)
const tableExists = async (client, name) =>
  (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`])).rows[0].ok

// ───────────────────────────────────────────────────────────────────────────
// ACKNOWLEDGEMENTS AND PREVIOUS STATE
// ───────────────────────────────────────────────────────────────────────────

function loadJson(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  if (!text.trim()) return null // an emptied file means "nothing acknowledged", the safe direction
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`Could not parse ${path}: ${e.message}`) // a corrupt file must be loud, not ignored
  }
}

const known = new Map() // key -> acknowledgement
const expiredAcks = []
let previous = null
try {
  for (const a of loadJson(KNOWN_FILE)?.acknowledged ?? []) {
    if (a.until && dayStart(a.until) < TODAY) expiredAcks.push(a)
    else known.set(a.key, a)
  }
  if (!HEALTH_ONLY && PREVIOUS_FILE) previous = loadJson(PREVIOUS_FILE)
} catch (e) {
  console.error(e.message)
  process.exit(2)
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK FRAMEWORK
// ───────────────────────────────────────────────────────────────────────────

/**
 * A result carries `items` (individual findings, each with a stable key so it can be
 * acknowledged and diffed between runs) and `detail` (context lines with no key).
 */
const results = []
const item = (key, text, r) => ({ key, text, r })

function record({ id, title, severity, count, items = [], detail = [], note = '' }) {
  results.push({ id, title, severity, count, items, detail, acknowledged: [], note, whole: false })
}

/** Per-item findings: acknowledged items are set aside BEFORE severity is decided. */
function report(id, title, items, { severity, note = '', detail = [], whole = false }) {
  const active = items.filter((i) => !known.has(i.key))
  const acknowledged = items.filter((i) => known.has(i.key))
  const sev = !active.length ? 'info' : typeof severity === 'function' ? severity(active) : severity
  results.push({ id, title, severity: sev, count: active.length, items: active, detail, acknowledged, note, whole })
}

const nearWindow = (near) => (active) => (active.some((i) => i.r.start < WINDOW_END) ? near : 'warn')

/** A check that throws must be loud: a silently skipped check reads as "all clear". */
async function check(id, title, fn) {
  if (HEALTH_ONLY && !HEALTH_CHECKS.has(id)) return
  if (SKIP_SITE && id.startsWith('D')) return
  try {
    await fn()
  } catch (e) {
    record({
      id,
      title,
      severity: 'critical',
      count: 1,
      items: [item(`${id}|error`, String(e.message).split('\n')[0])],
      note: 'CHECK ERROR — this check did not run. Fix the audit; do not ignore.',
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SITE FETCHING
// ───────────────────────────────────────────────────────────────────────────

/** One retry after a pause, so a cold start or a blip does not read as an outage. */
async function get(path) {
  const attempt = () => fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(30000) })
  try {
    const res = await attempt()
    if (res.status < 500) return res
  } catch {
    // fall through to the retry
  }
  await new Promise((r) => setTimeout(r, 5000))
  return attempt()
}

// ───────────────────────────────────────────────────────────────────────────
// CHECKS
// ───────────────────────────────────────────────────────────────────────────

async function runChecks(client, rows) {
  const cov = rows.filter((r) => COVERAGE_CATS.has(r.cat))
  const win = `${iso(WEEK_START)} → ${iso(addDays(WINDOW_END, -1))}`

  // ── A1. Started or starting soon, and nothing at all recorded ────────────
  const a1 = cov.filter(
    (r) =>
      r.start >= RECENT_START &&
      r.start < WINDOW_END &&
      r.md_cut == null && r.q_cut == null && r.d_cut == null &&
      r.draws.some(overdue)
  )
  const inA1 = new Set(a1.map((r) => r.edition_id)) // A2–A4 skip these, acknowledged or not
  await check('A1', `Events last week → next ${COVERAGE_WEEKS} week(s) with zero cut data`, async () => {
    report(
      'A1',
      `Events last week → next ${COVERAGE_WEEKS} week(s) with zero cut data`,
      a1.map((r) => item(`A1|${ek(r)}`, withRejected(r, label(r)), r)),
      { severity: 'critical', note: `Held ATP / Challenger / Slam events only (ITF is rolled up in B4). Window ${win}. A cut is due ${LEAD_DAYS} day(s) before the event starts (--lead), and no sooner than ${GRACE_DAYS} day(s) after its entry deadline.` }
    )
  })

  // ── A2–A4. A draw whose entry list has closed but whose cut is missing ───
  const lateDraws = (draw, extra = () => true) =>
    cov.filter(
      (r) =>
        r.start >= RECENT_START && r.start < addDays(WEEK_START, 60) &&
        !inA1.has(r.edition_id) &&
        extra(r) &&
        r.draws.some((d) => d.draw === draw && overdue(d)) &&
        !HAS[draw](r)
    )
  const lateItems = (id, list, draw) =>
    list.map((r) => {
      const closed = iso(r.draws.find((d) => d.draw === draw).deadline)
      return item(`${id}|${ek(r)}`, withRejected(r, `${label(r)} · entries closed ${closed}`), r)
    })

  await check('A2', 'Entry list closed, singles main-draw cut still missing', async () => {
    report('A2', 'Entry list closed, singles main-draw cut still missing', lateItems('A2', lateDraws('singles_main'), 'singles_main'), {
      severity: nearWindow('critical'),
      note: 'Deadlines come from src/lib/entry-deadlines.ts. Critical if any event starts inside the coverage window; a list of only later events is a warning. See --lead for when a cut counts as due.',
    })
  })

  await check('A3', 'Singles cut recorded but doubles cut missing', async () => {
    const list = lateDraws('doubles_main', (r) => r.md_cut != null)
    report('A3', 'Singles cut recorded but doubles cut missing', lateItems('A3', list, 'doubles_main'), {
      severity: nearWindow('critical'),
      note: 'Only counted once the doubles entry list has closed (ATP 14d, Challenger 7d, Slam 14d before the Monday). A Challenger doubles cut may sit in the advance/onsite columns; either counts.',
    })
  })

  await check('A4', 'Main-draw cut present but qualifying cut missing', async () => {
    const list = lateDraws('singles_qualifying', (r) => r.md_cut != null && r.cat !== 'grandslam')
    report('A4', 'Main-draw cut present but qualifying cut missing', lateItems('A4', list, 'singles_qualifying'), { severity: 'warn' })
  })

  // ── A5. Cut last written before its entry list closed → provisional ──────
  await check('A5', 'Cut last written before its entry deadline (provisional)', async () => {
    const stale = []
    for (const r of cov) {
      if (r.start < RECENT_START || r.start >= addDays(WEEK_START, 45)) continue
      for (const d of r.draws) {
        const written = r[WRITTEN[d.draw]]
        if (written && written < d.deadline && overdue(d))
          stale.push(item(`A5|${ek(r)}|${d.draw}`, `${label(r)} · ${d.draw} written ${iso(written)}, entries closed ${iso(d.deadline)}`, r))
      }
    }
    report('A5', 'Cut last written before its entry deadline (provisional)', stale, {
      severity: 'warn',
      note: 'A number captured before the entry list closed is not the deadline boundary, and nothing has refreshed it since.',
    })
  })

  // ── S1. Coverage scorecard (informational) ───────────────────────────────
  const scorecard = {}
  await check('S1', 'Coverage scorecard', async () => {
    let pending = 0
    for (const r of cov) {
      if (r.start < WEEK_START || r.start >= addDays(WEEK_START, 28)) continue
      for (const d of r.draws) {
        if (!overdue(d)) {
          if (AS_OF.getTime() > d.deadline.getTime() + GRACE_DAYS * MS_DAY && !HAS[d.draw](r)) pending++
          continue
        }
        if (r.start >= WINDOW_END) continue
        const s = (scorecard[d.draw] ??= { have: 0, expected: 0 })
        s.expected++
        if (HAS[d.draw](r)) s.have++
      }
    }
    const before = previous?.scorecard ?? {}
    const detail = Object.entries(scorecard).map(([draw, s]) => {
      const was = before[draw] ? ` (last run ${pctOf(before[draw].have, before[draw].expected)}%)` : ''
      return `${DRAW_LABEL[draw]}: ${s.have}/${s.expected} (${pctOf(s.have, s.expected)}%)${was}`
    })
    if (!detail.length) detail.push('no events in the window have a cut due yet')
    detail.push(`not yet due (entry list closed, cut expected around the draw): ${pending} draw(s) in the next 4 weeks`)
    record({
      id: 'S1',
      title: 'Coverage scorecard',
      severity: 'info',
      count: 0,
      detail,
      note: `Events starting ${win} whose cut is due (see --lead / --grace).`,
    })
  })

  // ── B1. Pipeline liveness ────────────────────────────────────────────────
  await check('B1', 'Cut importer liveness', async () => {
    const { rows: [b] } = await client.query(
      `SELECT max(updated_at) AS last,
              count(*) FILTER (WHERE updated_at > $1::timestamptz - interval '7 days') AS last7,
              count(*) FILTER (WHERE updated_at > $1::timestamptz - interval '30 days') AS last30,
              count(*) AS total
       FROM cutoff_snapshots`,
      [AS_OF.toISOString()]
    )
    const last7 = Number(b.last7)
    const ageDays = b.last ? Math.floor((AS_OF - new Date(b.last)) / MS_DAY) : 9999
    // Zero writes only means a broken importer while events are actually in play.
    const inPlay = cov.some((r) => r.start >= WEEK_START && r.start < WINDOW_END)
    record({
      id: 'B1',
      title: 'Cut importer liveness',
      severity: last7 === 0 ? (inPlay ? 'critical' : 'warn') : ageDays > 3 ? 'warn' : 'info',
      count: last7,
      detail: [
        `last write: ${b.last ? iso(new Date(b.last)) : 'never'} (${ageDays}d ago)`,
        `rows written last 7d: ${last7}`,
        `rows written last 30d: ${Number(b.last30)}`,
        `total cut rows: ${Number(b.total)}`,
      ],
      note: 'Zero writes in 7 days while events are in play means the PDF import is failing silently and the site is serving stale numbers.',
    })
  })

  // ── B3. Forward calendar gaps ────────────────────────────────────────────
  await check('B3', 'Weeks ahead with no or few tournaments loaded', async () => {
    const perWeek = new Map()
    for (const r of rows) perWeek.set(weekKey(r), (perWeek.get(weekKey(r)) ?? 0) + 1)
    const gaps = []
    for (let i = 0; i < 8; i++) {
      const k = iso(addDays(WEEK_START, i * 7))
      const n = perWeek.get(k) ?? 0
      if (n === 0) gaps.push(item(`B3|${k}`, `week of ${k} — 0 tournaments`, { zero: true }))
      else if (n < 4) gaps.push(item(`B3|${k}`, `week of ${k} — only ${n} tournaments`, { zero: false }))
    }
    report('B3', 'Weeks ahead with no or few tournaments loaded', gaps, {
      severity: (active) => (active.some((i) => i.r.zero) ? 'critical' : 'warn'),
      note: 'An empty forward week breaks the swing builder silently. Late-December weeks are legitimately thin.',
    })
  })

  // ── B4. ITF, rolled up (informational) ───────────────────────────────────
  await check('B4', 'ITF weekly cut coverage', async () => {
    const detail = []
    for (let i = -1; i <= 1; i++) {
      const k = iso(addDays(WEEK_START, i * 7))
      const itf = rows.filter((r) => r.cat === 'itf' && weekKey(r) === k)
      detail.push(`week of ${k} — ${itf.length} ITF events, ${itf.filter((r) => r.md_cut != null).length} with a singles main cut`)
    }
    record({ id: 'B4', title: 'ITF weekly cut coverage', severity: 'info', count: 0, detail })
  })

  // ── B5. Other pipelines gone quiet ───────────────────────────────────────
  await check('B5', 'Data pipelines gone quiet', async () => {
    const stale = []
    const detail = []
    for (const p of FRESHNESS) {
      if (!(await tableExists(client, p.table))) {
        detail.push(`${p.name}: table ${p.table} not present, skipped`)
        continue
      }
      const { rows: [f] } = await client.query(`SELECT max(${p.column}) AS t FROM ${p.table}`)
      const ageH = f.t ? Math.floor((AS_OF - new Date(f.t)) / 3600000) : null
      const text = `${p.name}: last ${f.t ? iso(new Date(f.t)) : 'never'}${ageH == null ? '' : ` (${ageH}h ago)`}, expected ${p.cadence}`
      if (ageH == null || ageH > p.maxHours) stale.push(item(`B5|${p.table}`, text))
      else detail.push(text)
    }
    report('B5', 'Data pipelines gone quiet', stale, {
      severity: 'warn',
      detail,
      note: 'Offseason lulls can trip this briefly. The audit cannot see workflow runs, only the timestamps they leave behind.',
    })
  })

  // ── C1. Impossible cut values ────────────────────────────────────────────
  await check('C1', 'Impossible cut values', async () => {
    const bad = []
    for (const r of rows) {
      const cuts = [
        ['singles main', 'singles', 'main', r.md_cut],
        ['singles qualifying', 'singles', 'qualifying', r.q_cut],
        ['doubles', 'doubles', 'main', r.d_rank],
        ['doubles advance', 'doubles', 'main', r.d_adv],
        ['doubles onsite', 'doubles', 'main', r.d_onsite],
      ]
      for (const [name, event, drawType, v] of cuts) {
        if (v == null) continue
        const min = minPlausibleRank(r.level, event, drawType)
        const max = (r.cat === 'itf' ? MAX_CUT_ITF : MAX_CUT)[event]
        if (v < min || v > max)
          bad.push(item(`C1|${ek(r)}|${name}`, `${label(r)} · ${name} cut = ${v} (plausible ${min}–${max})`, r))
      }
    }
    report('C1', 'Impossible cut values', bad, {
      severity: 'critical',
      note: 'Lower bounds are the app’s own minPlausibleRank. Upper bounds: singles 2500 (ITF 4000), doubles 6000. The app’s /api/cleanup-anomalous-cuts sweeps single-digit parser misreads.',
    })
  })

  // ── C2. Qualifying cut better than main-draw cut ─────────────────────────
  await check('C2', 'Qualifying cut better than main-draw cut (inverted)', async () => {
    const bad = rows
      .filter((r) => r.md_cut != null && r.q_cut != null && r.q_cut < r.md_cut)
      .map((r) => item(`C2|${ek(r)}`, `${label(r)} · MD ${r.md_cut} vs Q ${r.q_cut}`, r))
    report('C2', 'Qualifying cut better than main-draw cut (inverted)', bad, {
      severity: (active) => (active.some((i) => i.r.cat !== 'itf') ? 'critical' : 'warn'),
      note: 'Impossible for ATP / Challenger / Slam, which is critical (a parser misread or swapped sheets). ITF entry lists use different ranking dates per draw, so a small ITF inversion is only a warning.',
    })
  })

  // ── C3. Duplicate editions ───────────────────────────────────────────────
  await check('C3', 'Duplicate tournament editions', async () => {
    const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
    const buckets = new Map()
    for (const r of rows) {
      if (r.cat === 'itf' || r.cat === null) continue // ITF legitimately runs several same-city events a week
      const k = `${weekKey(r)}|${norm(r.country)}|${r.cat}`
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(r)
    }
    const dupes = []
    for (const group of buckets.values())
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const a = norm(group[i].name), b = norm(group[j].name)
          const sameCity = norm(group[i].city) && norm(group[i].city) === norm(group[j].city)
          if ((a && b && (a.includes(b) || b.includes(a))) || sameCity) {
            const [x, y] = [group[i], group[j]].sort((p, q) => p.slug.localeCompare(q.slug))
            dupes.push(item(`C3|${ek(x)}|${ek(y)}`, `${x.name} (${x.slug}) ⟷ ${y.name} (${y.slug}) · ${weekKey(x)} · ${x.country}`))
          }
        }
    report('C3', 'Duplicate tournament editions', dupes, {
      severity: 'warn',
      note: 'Same week + country + level with near-identical name or the same city. Duplicates double-count supply in the depth model. /api/city-dupes digs further.',
    })
  })

  // ── C4. Name says one ITF level, level says another ──────────────────────
  await check('C4', 'Tournament name contradicts its level field', async () => {
    const bad = []
    for (const r of rows) {
      const nm = r.name.match(/\bM(15|25)\b/i)
      const lm = r.level.match(/\bM(15|25)\b/i)
      if (nm && lm && nm[1] !== lm[1]) bad.push(item(`C4|${ek(r)}`, `${r.name} → level "${r.level}"`, r))
    }
    report('C4', 'Tournament name contradicts its level field', bad, { severity: 'warn' })
  })

  // ── C5. Missing coordinates (drops an event out of swing chains) ─────────
  await check('C5', 'Upcoming tournaments missing coordinates', async () => {
    const seen = new Set()
    const bad = []
    for (const r of rows) {
      if (r.start < WEEK_START || r.start >= addDays(WEEK_START, 56)) continue
      if (r.latitude != null && r.longitude != null) continue
      if (seen.has(r.slug)) continue
      seen.add(r.slug)
      bad.push(item(`C5|${r.slug}`, `${r.name} · ${r.country ?? '(no country)'} · ${r.start_date}`, r))
    }
    report('C5', 'Upcoming tournaments missing coordinates', bad, {
      severity: 'warn',
      note: 'No coordinates means the event cannot join a swing chain. /api/geocode-tournaments backfills them.',
    })
  })

  // ── C6. Malformed country values ─────────────────────────────────────────
  await check('C6', 'Malformed country values', async () => {
    const counts = new Map()
    for (const r of rows) counts.set(r.country, (counts.get(r.country) ?? 0) + 1)
    const bad = [...counts]
      .filter(([c]) => {
        const v = String(c ?? '').trim()
        return !v || /^[A-Z]{3}$/.test(v) || (/\.\s*$/.test(v) && !v.includes(','))
      })
      .map(([c, n]) => item(`C6|${c ?? '(null)'}`, `"${c ?? '(null)'}" — ${n} editions`))
    report('C6', 'Malformed country values', bad, {
      severity: 'warn',
      note: 'The app stores full country names. A code, abbreviation or blank never matches a full name, which silently breaks same-country swing links.',
    })
  })

  // ── C7. Stored week disagrees with the ATP season week ───────────────────
  await check('C7', 'Stored week number disagrees with the ATP season week', async () => {
    const bad = rows
      .filter((r) => r.week !== getAtpWeekForSeason(r.start_date, r.year))
      .map((r) => item(`C7|${ek(r)}`, `${label(r)} · stored wk ${r.week ?? 'null'}, expected ${getAtpWeekForSeason(r.start_date, r.year)}`, r))
    report('C7', 'Stored week number disagrees with the ATP season week', bad, {
      severity: 'warn',
      note: 'Uses the ATP season rule from src/lib/atp-week.ts, not ISO weeks. /api/fix-weeks recomputes them.',
    })
  })

  // ── C8. Draw-size coverage ───────────────────────────────────────────────
  await check('C8', 'Draw-size coverage', async () => {
    const pool = rows.filter((r) => r.cat !== 'itf' && r.start < WINDOW_END)
    const have = pool.filter((r) => r.singles_draw_size != null).length
    const pct = pctOf(have, pool.length)
    const text = `singles_draw_size populated: ${have}/${pool.length} (${pct}%)`
    report('C8', 'Draw-size coverage', pct < 50 ? [item('C8', text)] : [], {
      severity: 'warn',
      detail: pct < 50 ? [] : [text],
      note: 'Draw size feeds absorption capacity in the depth model. Acknowledge key "C8" if the column is known debt.',
    })
  })

  // ── E1. Deadline-alert emails actually going out ─────────────────────────
  await check('E1', 'Deadline alert emails', async () => {
    if (!(await tableExists(client, 'alert_subscribers')) || !(await tableExists(client, 'alert_sends'))) {
      record({ id: 'E1', title: 'Deadline alert emails', severity: 'info', count: 0, detail: ['alert tables not present, skipped'] })
      return
    }
    const subs = (
      await client.query(`SELECT count(*)::int AS n FROM alert_subscribers WHERE active AND unsubscribed_at IS NULL`)
    ).rows[0].n
    const cats = new Set(
      (
        await client.query(
          `SELECT DISTINCT c FROM alert_subscribers, unnest(categories) AS c WHERE active AND unsubscribed_at IS NULL`
        )
      ).rows.map((x) => x.c)
    )
    const { rows: [s] } = await client.query(
      `SELECT count(*)::int AS n, max(sent_at) AS last FROM alert_sends WHERE sent_at > $1::timestamptz - interval '7 days'`,
      [AS_OF.toISOString()]
    )
    // Deadlines a subscriber could have been emailed about in the last week.
    const from = addDays(AS_OF, -7)
    let due = 0
    for (const r of rows)
      for (const d of deadlinesForEdition(r)) {
        const at = new Date(d.deadlineAtIso)
        if (d.kind !== 'doubles' && cats.has(d.category) && at > from && at <= AS_OF) due++
      }
    const dead = subs > 0 && due > 0 && s.n === 0
    record({
      id: 'E1',
      title: 'Deadline alert emails',
      severity: dead ? 'critical' : 'info',
      count: s.n,
      items: dead ? [item('E1', `${subs} active subscriber(s), ${due} entry deadline(s) passed in the last 7 days, zero alert emails sent`)] : [],
      detail: [
        `active subscribers: ${subs} (categories: ${[...cats].sort().join(', ') || 'none'})`,
        `entry deadlines passed in the last 7 days (subscribed categories, excluding doubles): ${due}`,
        `alert emails sent in the last 7 days: ${s.n}${s.last ? ` (last ${iso(new Date(s.last))})` : ''}`,
      ],
      note: 'Zero sends despite subscribers and passed deadlines means the hourly alert job or the mail provider is failing silently, and that is the product.',
    })
  })

  // ── D. Site health ───────────────────────────────────────────────────────
  await check('D1', 'Core page health', async () => {
    const pages = [
      ['/', 2000], ['/cuts', 2000], ['/schedule', 2000], ['/alerts', 2000],
      ['/swings', 2000], ['/depth', 2000], ['/lists', 2000],
      ['/sitemap.xml', 50], ['/robots.txt', 20],
    ]
    const out = []
    let bad = 0
    let slow = 0
    for (const [p, minBytes] of pages) {
      const t0 = Date.now()
      try {
        const res = await get(p)
        const body = await res.text()
        const ms = Date.now() - t0
        const ok = res.ok && body.length >= minBytes
        const isSlow = ok && ms > SLOW_MS
        if (!ok) bad++
        if (isSlow) slow++
        out.push(`${p} — ${res.status} · ${ms}ms · ${body.length} bytes${ok ? '' : '  ← FAIL'}${isSlow ? '  ← SLOW' : ''}`)
      } catch (e) {
        bad++
        out.push(`${p} — request failed: ${e.message}  ← FAIL`)
      }
    }
    record({
      id: 'D1',
      title: 'Core page health',
      severity: bad ? 'critical' : slow ? 'warn' : 'info',
      count: bad + slow,
      items: out.filter((l) => /←/.test(l)).map((l) => item(`D1|${l.split(' ')[0]}`, l)),
      detail: out.filter((l) => !/←/.test(l)),
    })
  })

  await check('D2', 'Current-week tournament pages show the stored cut', async () => {
    const pool = cov
      .filter((r) => r.md_cut != null && r.start >= WEEK_START && r.start < addDays(WEEK_START, 7))
      .sort(() => Math.random() - 0.5)
      .slice(0, 5)
    const fails = []
    const detail = []
    for (const r of pool) {
      try {
        const res = await get(`/tournaments/${r.slug}`)
        const html = await res.text()
        const text = html
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
        // The page shows the cut in the edition's detail row, and in a by-year history line once the
        // tournament has more than one year of data. Either proves the stored number is rendered.
        const shown =
          new RegExp(`Singles main PDF source\\s*${r.md_cut}\\b`).test(text) ||
          new RegExp(`${r.year}\\s*·\\s*Singles main cut\\s*#\\s*${r.md_cut}\\b`).test(text)
        if (res.ok && shown) detail.push(`${r.name} — ${res.status} · singles main cut #${r.md_cut} shown ✓`)
        else fails.push(item(`D2|${r.slug}`, `${r.name} — ${res.status} · singles main cut #${r.md_cut} not found on the page  ← FAIL`, r))
      } catch (e) {
        fails.push(item(`D2|${r.slug}`, `${r.name} — ${e.message}  ← FAIL`, r))
      }
    }
    if (!pool.length) detail.push('no current-week events with a recorded cut to sample')
    report('D2', 'Current-week tournament pages show the stored cut', fails, {
      severity: 'critical',
      detail,
      whole: true,
      note: 'Catches data present in Postgres but missing or wrong on the page. Random sample of up to 5, so a failure may not repeat next run.',
    })
  })

  await check('D3', 'OG image endpoint', async () => {
    const res = await get('/opengraph-image')
    const ct = res.headers.get('content-type') || ''
    const ok = res.ok && ct.includes('image')
    record({
      id: 'D3',
      title: 'OG image endpoint',
      severity: ok ? 'info' : 'warn',
      count: ok ? 0 : 1,
      detail: [`${res.status} · ${ct || 'no content-type'}`],
      note: 'A failure here breaks every share preview without breaking the site.',
    })
  })

  return { scorecard }
}

// ───────────────────────────────────────────────────────────────────────────
// STATE, DIFF AND REPORTING
// ───────────────────────────────────────────────────────────────────────────

const activeResults = () => results.filter((r) => r.severity !== 'info')
const summarise = () => ({
  crit: results.filter((r) => r.severity === 'critical'),
  warn: results.filter((r) => r.severity === 'warn'),
})

/** Every open finding with a stable key. A check with no per-item keys counts as one finding. */
function findings() {
  return activeResults().flatMap((r) =>
    !r.whole && r.items.some((i) => i.key)
      ? r.items.map((i) => ({ key: i.key, id: r.id, severity: r.severity, text: i.text }))
      : [{ key: r.id, id: r.id, severity: r.severity, text: r.title }]
  )
}

function diffAgainstPrevious(current) {
  if (!previous) return null
  const prevKeys = new Set(previous.findings.map((f) => f.key))
  const nowKeys = new Set(current.map((f) => f.key))
  const ran = new Set(results.map((r) => r.id)) // a check that did not run this time cannot resolve anything
  return {
    since: previous.asOf,
    fresh: new Set(current.filter((f) => !prevKeys.has(f.key)).map((f) => f.key)),
    resolved: previous.findings.filter((f) => ran.has(f.id) && !nowKeys.has(f.key) && !known.has(f.key)),
    kept: current.filter((f) => prevKeys.has(f.key)).length,
  }
}

const isFresh = (diff, r, i) => diff?.fresh.has(r.whole ? r.id : i.key) ?? false
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const runTitle = () => (HEALTH_ONLY ? 'daily health check' : 'Monday audit')

function scorecardLine(scorecard) {
  const parts = Object.entries(scorecard).map(([d, s]) => `${DRAW_LABEL[d].replace('singles ', '').replace(' main', '')} ${s.have}/${s.expected}`)
  return parts.length ? `Coverage: ${parts.join(' · ')}` : null
}

function headline(diff) {
  const { crit, warn } = summarise()
  const bits = []
  bits.push(crit.length ? `🔴 ${crit.length} critical` : '🟢 no criticals')
  if (warn.length) bits.push(`🟡 ${warn.length} warnings`)
  if (diff) bits.push(`🆕 ${diff.fresh.size} new`, `✅ ${diff.resolved.length} resolved`)
  const ack = results.reduce((n, r) => n + r.acknowledged.length, 0)
  if (ack) bits.push(`🤫 ${ack} acknowledged`)
  return bits.join(' · ')
}

function buildTelegram(diff, scorecard) {
  const L = [`<b>TennisCuts — ${runTitle()} · ${iso(TODAY)}</b>`, headline(diff)]
  const sc = scorecardLine(scorecard)
  if (sc) L.push(escapeHtml(sc))
  for (const r of activeResults()) {
    L.push('', `${ICON[r.severity]} <b>${escapeHtml(r.title)}</b> — ${r.count}`)
    const rows = [...r.items].sort((a, b) => Number(isFresh(diff, r, b)) - Number(isFresh(diff, r, a)))
    for (const i of rows.slice(0, 6)) L.push(`· ${isFresh(diff, r, i) ? '🆕 ' : ''}${escapeHtml(i.text)}`)
    if (rows.length > 6) L.push(`· …and ${rows.length - 6} more`)
  }
  if (diff?.resolved.length) L.push('', `✅ <b>Resolved since ${escapeHtml(diff.since)}</b>: ${diff.resolved.length}`)
  if (RUN_URL) L.push('', `Full report: ${RUN_URL}`)
  const msg = L.join('\n')
  return msg.length > 3900 ? msg.slice(0, 3800) + `\n\n<i>…truncated.</i>${RUN_URL ? `\nFull report: ${RUN_URL}` : ''}` : msg
}

function buildMarkdown(diff) {
  const L = [
    `# TennisCuts — ${runTitle()}`,
    `_${AS_OF.toISOString()}_ · site: ${SITE} · window: ${iso(WEEK_START)} → ${iso(addDays(WINDOW_END, -1))} · grace: ${GRACE_DAYS}d${RUN_URL ? ` · [run](${RUN_URL})` : ''}`,
    '',
    `**${headline(diff)}**`,
    '',
  ]
  if (diff) L.push(`Since ${diff.since}: ${diff.fresh.size} new, ${diff.resolved.length} resolved, ${diff.kept} unchanged.`, '')
  else if (!HEALTH_ONLY) L.push('No earlier run to compare against, so nothing is marked new.', '')
  if (expiredAcks.length)
    L.push(`⚠️ ${expiredAcks.length} acknowledgement(s) expired and are back in play: ${expiredAcks.map((a) => a.key).join(', ')}`, '')

  const quiet = []
  for (const r of results) {
    if (r.severity === 'info' && !r.items.length && !r.detail.length && !r.acknowledged.length) {
      quiet.push(`${r.id} — ${r.title}`)
      continue
    }
    L.push(`## ${r.severity === 'info' ? '✅' : ICON[r.severity]} ${r.id} — ${r.title}`)
    L.push(`Count: **${r.count}**`)
    if (r.note) L.push(`> ${r.note}`)
    if (r.items.length || r.detail.length) {
      L.push('')
      for (const i of r.items.slice(0, 60)) L.push(`- ${isFresh(diff, r, i) ? '🆕 ' : ''}${i.text}`)
      if (r.items.length > 60) L.push(`- …and ${r.items.length - 60} more`)
      for (const d of r.detail) L.push(`- ${d}`)
    }
    if (r.acknowledged.length) {
      L.push('', `<details><summary>${r.acknowledged.length} acknowledged</summary>`, '')
      for (const i of r.acknowledged.slice(0, 60)) L.push(`- ${i.text} — _${known.get(i.key).reason ?? 'no reason given'}, until ${known.get(i.key).until ?? 'n/a'}_`)
      L.push('', '</details>')
    }
    L.push('')
  }
  if (diff?.resolved.length) {
    L.push('## ✅ Resolved since last run', '')
    for (const f of diff.resolved.slice(0, 60)) L.push(`- ${f.text}`)
    L.push('')
  }
  if (quiet.length) L.push('## Passing', '', ...quiet.map((q) => `- ✅ ${q}`), '')
  return L.join('\n')
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    console.log('\n[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send.')
    return
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  const j = await res.json().catch(() => ({}))
  console.log(`[telegram] ${res.status} ${j.ok ? 'sent' : JSON.stringify(j).slice(0, 200)}`)
}

const say = (s) => new Promise((resolve) => process.stdout.write(s + '\n', resolve))

// ───────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      'DATABASE_URL is not set. In CI, add it as a repository secret: the Railway *public* Postgres URL ' +
        '(Railway → Postgres service → Variables → DATABASE_PUBLIC_URL).'
    )
    process.exit(2)
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  })
  await client.connect()
  // The audit only reads. Enforce it, since CI holds a production connection string.
  await client.query('SET default_transaction_read_only = on')
  await client.query("SET statement_timeout = '120s'")

  let extra
  try {
    const rows = await loadEditions(client)
    extra = await runChecks(client, rows)
  } finally {
    await client.end()
  }

  if (EMIT_KNOWN) {
    const until = iso(addDays(TODAY, ACK_DAYS))
    const baseline = results
      .filter((r) => /^(A|B3|C)/.test(r.id) && !r.note.includes('CHECK ERROR'))
      .flatMap((r) => r.items.map((i) => ({ key: i.key, until, reason: 'baseline — review', text: i.text })))
    const merged = [...known.values(), ...baseline]
    writeFileSync(KNOWN_FILE, JSON.stringify({ acknowledged: merged }, null, 2) + '\n')
    await say(`Wrote ${merged.length} acknowledgement(s) to ${KNOWN_FILE} (${baseline.length} new, ${known.size} kept). Review it before committing.`)
    process.exit(0)
  }

  const current = findings()
  const diff = diffAgainstPrevious(current)
  const md = buildMarkdown(diff)
  await say(md)
  writeFileSync('monday-audit-report.md', md)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  if (!HEALTH_ONLY)
    writeFileSync(
      'monday-audit-state.json',
      JSON.stringify({ asOf: iso(TODAY), findings: current, scorecard: extra.scorecard }, null, 2)
    )

  const message = buildTelegram(diff, extra.scorecard)
  const quietHealth = HEALTH_ONLY && !summarise().crit.length && !summarise().warn.length
  if (DRY_RUN) await say(`\n--- Telegram preview (not sent) ---\n${message.replace(/<\/?[bi]>/g, '')}`)
  else if (quietHealth) console.log('[telegram] health run is clean — not sending a message.')
  else await sendTelegram(message)

  process.exit(summarise().crit.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
