#!/usr/bin/env node
/**
 * TennisCuts Monday Audit — weekly integrity + health check for tenniscuts.com.
 *
 * Answers three questions:
 *   1. Is every cut that SHOULD exist by now actually in the database?
 *   2. Is any stored data impossible, duplicated, or self-contradictory?
 *   3. Is the site rendering that data?
 *
 * Run through tsx: it imports the app's own deadline, anomaly and ATP-week rules
 * from src/lib so the audit cannot drift from what the app itself believes.
 *
 *   npx tsx scripts/monday-audit.mjs --dry-run          # print the report, send nothing
 *   npx tsx scripts/monday-audit.mjs                    # report + Telegram (if configured)
 *   npx tsx scripts/monday-audit.mjs --weeks=3          # widen the coverage window
 *   npx tsx scripts/monday-audit.mjs --grace=5          # days to allow after a deadline
 *   npx tsx scripts/monday-audit.mjs --as-of=2026-07-06 # replay as if run on that date
 *
 * Env:
 *   DATABASE_URL        required  Postgres URL (Railway *public* URL from CI; read-only is enough)
 *   SITE_URL            optional  default https://tenniscuts.com
 *   TELEGRAM_BOT_TOKEN  optional  with TELEGRAM_CHAT_ID, sends the summary; otherwise skipped
 *   TELEGRAM_CHAT_ID    optional
 *   GITHUB_STEP_SUMMARY auto      set by GitHub Actions
 *
 * Exit code 1 when any CRITICAL fires, so a scheduled run goes red and GitHub emails you.
 */

import pg from 'pg'
import { writeFileSync, appendFileSync } from 'node:fs'
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
const COVERAGE_WEEKS = parseInt(OPT('weeks', '2'), 10) // current week + N-1 ahead
// A cut can only exist once its entry list is posted, which is after the deadline.
const GRACE_DAYS = Number(OPT('grace', '3'))
const AS_OF = OPT('as-of') ? new Date(`${OPT('as-of')}T13:00:00Z`) : new Date()

// Upper plausibility bounds. The lower bounds come from the app's own minPlausibleRank.
const MAX_CUT = { singles: 2500, doubles: 6000 }

const MS_DAY = 86400000
const COVERAGE_CATS = new Set(['atp', 'challenger', 'grandslam'])
const ICON = { critical: '🔴', warn: '🟡', info: '⚪' }

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
 * UPDATE in place, so updated_at (not created_at) is the "last written" signal.
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

/**
 * The draws an edition should carry a cut for, each with the moment its entry
 * list closes. Mirrors /api/missing-cuts-report: a Slam has singles + doubles
 * main only, "<Slam> Qualifying" is its own entry with singles qualifying only,
 * everything else has singles main + qualifying + doubles main. ITF is not
 * covered (the app's own report excludes it too).
 */
function expectedDraws(r) {
  if (!COVERAGE_CATS.has(r.cat)) return []
  if (isGrandSlamQualifyingLevel(r.level)) {
    // Qualifying closes 28 days before the MAIN draw Monday; this entry sits a week earlier.
    return [{ draw: 'singles_qualifying', deadline: addDays(mondayOfWeekUtc(r.start), -21) }]
  }
  const byKind = Object.fromEntries(deadlinesForEdition(r).map((d) => [d.kind, new Date(d.deadlineAtIso)]))
  const out = [{ draw: 'singles_main', deadline: byKind.main }]
  if (r.cat !== 'grandslam') out.push({ draw: 'singles_qualifying', deadline: byKind.qualifying })
  out.push({ draw: 'doubles_main', deadline: byKind.doubles })
  return out.filter((d) => d.deadline)
}

const overdue = (d) => AS_OF.getTime() > d.deadline.getTime() + GRACE_DAYS * MS_DAY
const label = (r) => `${r.name} · ${r.level} · ${r.start_date}`
const withRejected = (r, s) => (r.rejected ? `${s} · parsed cut was rejected as anomalous` : s)
const weekKey = (r) => iso(mondayOfWeekUtc(r.start))
const severityFor = (list, near) => (!list.length ? 'info' : list.some((r) => r.start < WINDOW_END) ? near : 'warn')

// ───────────────────────────────────────────────────────────────────────────
// CHECK FRAMEWORK
// ───────────────────────────────────────────────────────────────────────────

const results = []
const record = (r) => results.push({ rows: [], note: '', ...r })

/** A check that throws must be loud: a silently skipped check reads as "all clear". */
async function check(id, title, fn) {
  try {
    await fn()
  } catch (e) {
    record({
      id,
      title,
      severity: 'critical',
      count: 1,
      rows: [String(e.message).split('\n')[0]],
      note: 'CHECK ERROR — this check did not run. Fix the audit; do not ignore.',
    })
  }
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
  await check('A1', `Events last week → next ${COVERAGE_WEEKS} week(s) with zero cut data`, async () => {
    record({
      id: 'A1',
      title: `Events last week → next ${COVERAGE_WEEKS} week(s) with zero cut data`,
      severity: a1.length ? 'critical' : 'info',
      count: a1.length,
      rows: a1.map((r) => withRejected(r, label(r))),
      note: `Held ATP / Challenger / Slam events only (ITF is rolled up in B4). Window ${win}.`,
    })
  })
  const inA1 = new Set(a1.map((r) => r.edition_id))

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
  const deadlineOf = (r, draw) => iso(r.draws.find((d) => d.draw === draw).deadline)
  const rowsFor = (list, draw) =>
    list.map((r) => withRejected(r, `${label(r)} · entries closed ${deadlineOf(r, draw)}`))

  await check('A2', 'Entry list closed, singles main-draw cut still missing', async () => {
    const list = lateDraws('singles_main')
    record({
      id: 'A2',
      title: 'Entry list closed, singles main-draw cut still missing',
      severity: severityFor(list, 'critical'),
      count: list.length,
      rows: rowsFor(list, 'singles_main'),
      note: 'Deadlines come from src/lib/entry-deadlines.ts. Critical if any event starts inside the coverage window; a list of only later events is a warning.',
    })
  })

  await check('A3', 'Singles cut recorded but doubles cut missing', async () => {
    const list = lateDraws('doubles_main', (r) => r.md_cut != null)
    record({
      id: 'A3',
      title: 'Singles cut recorded but doubles cut missing',
      severity: severityFor(list, 'critical'),
      count: list.length,
      rows: rowsFor(list, 'doubles_main'),
      note: 'Only counted once the doubles entry list has closed (ATP 14d, Challenger 7d, Slam 14d before the Monday). A Challenger doubles cut may sit in the advance/onsite columns; either counts.',
    })
  })

  await check('A4', 'Main-draw cut present but qualifying cut missing', async () => {
    const list = lateDraws('singles_qualifying', (r) => r.md_cut != null && r.cat !== 'grandslam')
    record({
      id: 'A4',
      title: 'Main-draw cut present but qualifying cut missing',
      severity: list.length ? 'warn' : 'info',
      count: list.length,
      rows: rowsFor(list, 'singles_qualifying'),
    })
  })

  // ── A5. Cut last written before its entry list closed → provisional ──────
  await check('A5', 'Cut last written before its entry deadline (provisional)', async () => {
    const stale = []
    for (const r of cov) {
      if (r.start < RECENT_START || r.start >= addDays(WEEK_START, 45)) continue
      for (const d of r.draws) {
        const written = r[WRITTEN[d.draw]]
        if (written && written < d.deadline && overdue(d))
          stale.push(`${label(r)} · ${d.draw} written ${iso(written)}, entries closed ${iso(d.deadline)}`)
      }
    }
    record({
      id: 'A5',
      title: 'Cut last written before its entry deadline (provisional)',
      severity: stale.length ? 'warn' : 'info',
      count: stale.length,
      rows: stale,
      note: 'A number captured before the entry list closed is not the deadline boundary, and nothing has refreshed it since.',
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
      rows: [
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
      if (n === 0) gaps.push(`week of ${k} — 0 tournaments`)
      else if (n < 4) gaps.push(`week of ${k} — only ${n} tournaments`)
    }
    record({
      id: 'B3',
      title: 'Weeks ahead with no or few tournaments loaded',
      severity: gaps.some((g) => g.endsWith('0 tournaments')) ? 'critical' : gaps.length ? 'warn' : 'info',
      count: gaps.length,
      rows: gaps,
      note: 'An empty forward week breaks the swing builder silently. Late-December weeks are legitimately thin.',
    })
  })

  // ── B4. ITF, rolled up (informational) ───────────────────────────────────
  await check('B4', 'ITF weekly cut coverage', async () => {
    const lines = []
    for (let i = -1; i <= 1; i++) {
      const k = iso(addDays(WEEK_START, i * 7))
      const itf = rows.filter((r) => r.cat === 'itf' && weekKey(r) === k)
      lines.push(`week of ${k} — ${itf.length} ITF events, ${itf.filter((r) => r.md_cut != null).length} with a singles main cut`)
    }
    record({ id: 'B4', title: 'ITF weekly cut coverage', severity: 'info', count: 0, rows: lines })
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
        if (v < min || v > MAX_CUT[event]) bad.push(`${label(r)} · ${name} cut = ${v} (plausible ${min}–${MAX_CUT[event]})`)
      }
    }
    record({
      id: 'C1',
      title: 'Impossible cut values',
      severity: bad.length ? 'critical' : 'info',
      count: bad.length,
      rows: bad,
      note: 'Lower bounds are the app’s own minPlausibleRank; upper bounds are singles 2500, doubles 6000.',
    })
  })

  // ── C2. Qualifying cut better than main-draw cut ─────────────────────────
  await check('C2', 'Qualifying cut better than main-draw cut (inverted)', async () => {
    const bad = rows.filter((r) => r.md_cut != null && r.q_cut != null && r.q_cut < r.md_cut)
    record({
      id: 'C2',
      title: 'Qualifying cut better than main-draw cut (inverted)',
      severity: bad.length ? 'critical' : 'info',
      count: bad.length,
      rows: bad.map((r) => `${label(r)} · MD ${r.md_cut} vs Q ${r.q_cut}`),
      note: 'Physically impossible. Suggests the parser swapped the MD and Q sheets.',
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
          if ((a && b && (a.includes(b) || b.includes(a))) || sameCity)
            dupes.push(`${group[i].name} (${group[i].slug}) ⟷ ${group[j].name} (${group[j].slug}) · ${weekKey(group[i])} · ${group[i].country}`)
        }
    record({
      id: 'C3',
      title: 'Duplicate tournament editions',
      severity: dupes.length ? 'warn' : 'info',
      count: dupes.length,
      rows: dupes,
      note: 'Same week + country + level with near-identical name or the same city. Duplicates double-count supply in the depth model. /api/city-dupes digs further.',
    })
  })

  // ── C4. Name says one ITF level, level says another ──────────────────────
  await check('C4', 'Tournament name contradicts its level field', async () => {
    const bad = []
    for (const r of rows) {
      const nm = r.name.match(/\bM(15|25)\b/i)
      const lm = r.level.match(/\bM(15|25)\b/i)
      if (nm && lm && nm[1] !== lm[1]) bad.push(`${r.name} → level "${r.level}"`)
    }
    record({ id: 'C4', title: 'Tournament name contradicts its level field', severity: bad.length ? 'warn' : 'info', count: bad.length, rows: bad })
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
      bad.push(`${r.name} · ${r.country ?? '(no country)'} · ${r.start_date}`)
    }
    record({
      id: 'C5',
      title: 'Upcoming tournaments missing coordinates',
      severity: bad.length ? 'warn' : 'info',
      count: bad.length,
      rows: bad,
      note: 'No coordinates means the event cannot join a swing chain. /api/geocode-tournaments backfills them.',
    })
  })

  // ── C6. Malformed country values ─────────────────────────────────────────
  await check('C6', 'Malformed country values', async () => {
    const counts = new Map()
    for (const r of rows) counts.set(r.country, (counts.get(r.country) ?? 0) + 1)
    const bad = [...counts].filter(([c]) => {
      const v = String(c ?? '').trim()
      return !v || /^[A-Z]{3}$/.test(v) || /\.\s*$/.test(v)
    })
    record({
      id: 'C6',
      title: 'Malformed country values',
      severity: bad.length ? 'warn' : 'info',
      count: bad.length,
      rows: bad.map(([c, n]) => `"${c ?? '(null)'}" — ${n} editions`),
      note: 'The app stores full country names. A code, abbreviation or blank never matches a full name, which silently breaks same-country swing links.',
    })
  })

  // ── C7. Stored week disagrees with the ATP season week ───────────────────
  await check('C7', 'Stored week number disagrees with the ATP season week', async () => {
    const bad = rows.filter((r) => r.week !== getAtpWeekForSeason(r.start_date, r.year))
    record({
      id: 'C7',
      title: 'Stored week number disagrees with the ATP season week',
      severity: bad.length ? 'warn' : 'info',
      count: bad.length,
      rows: bad.map((r) => `${label(r)} · stored wk ${r.week ?? 'null'}, expected ${getAtpWeekForSeason(r.start_date, r.year)}`),
      note: 'Uses the ATP season rule from src/lib/atp-week.ts, not ISO weeks. /api/fix-weeks recomputes them.',
    })
  })

  // ── C8. Draw-size coverage ───────────────────────────────────────────────
  await check('C8', 'Draw-size coverage', async () => {
    const pool = rows.filter((r) => r.cat !== 'itf' && r.start < WINDOW_END)
    const have = pool.filter((r) => r.singles_draw_size != null).length
    const pct = pool.length ? Math.round((have / pool.length) * 100) : 100
    record({
      id: 'C8',
      title: 'Draw-size coverage',
      severity: pct < 50 ? 'warn' : 'info',
      count: pct,
      rows: [`singles_draw_size populated: ${have}/${pool.length} (${pct}%)`],
      note: 'Draw size feeds absorption capacity in the depth model.',
    })
  })

  // ── D. Site health ───────────────────────────────────────────────────────
  const get = (path) => fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(30000) })

  await check('D1', 'Core page health', async () => {
    const out = []
    let bad = 0
    for (const p of ['/', '/cuts', '/alerts']) {
      const t0 = Date.now()
      try {
        const res = await get(p)
        const body = await res.text()
        const ok = res.ok && body.length > 500
        if (!ok) bad++
        out.push(`${p} — ${res.status} · ${Date.now() - t0}ms · ${body.length} bytes${ok ? '' : '  ← FAIL'}`)
      } catch (e) {
        bad++
        out.push(`${p} — request failed: ${e.message}  ← FAIL`)
      }
    }
    record({ id: 'D1', title: 'Core page health', severity: bad ? 'critical' : 'info', count: bad, rows: out })
  })

  await check('D2', 'Current-week tournament pages show the stored cut', async () => {
    const pool = cov
      .filter((r) => r.md_cut != null && r.start >= WEEK_START && r.start < addDays(WEEK_START, 7))
      .sort(() => Math.random() - 0.5)
      .slice(0, 5)
    const out = []
    let bad = 0
    for (const r of pool) {
      try {
        const res = await get(`/tournaments/${r.slug}`)
        const html = await res.text()
        const text = html
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
        const shown = new RegExp(`${r.year}\\s*·\\s*Singles main cut\\s*#\\s*${r.md_cut}\\b`).test(text)
        if (!res.ok || !shown) bad++
        out.push(`${r.name} — ${res.status} · expected "${r.year} · Singles main cut #${r.md_cut}"${res.ok && shown ? ' ✓' : '  ← FAIL'}`)
      } catch (e) {
        bad++
        out.push(`${r.name} — ${e.message}  ← FAIL`)
      }
    }
    if (!pool.length) out.push('no current-week events with a recorded cut to sample')
    record({
      id: 'D2',
      title: 'Current-week tournament pages show the stored cut',
      severity: bad ? 'critical' : 'info',
      count: bad,
      rows: out,
      note: 'Catches data present in Postgres but missing or wrong on the page.',
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
      rows: [`${res.status} · ${ct || 'no content-type'}`],
      note: 'A failure here breaks every share preview without breaking the site.',
    })
  })
}

// ───────────────────────────────────────────────────────────────────────────
// REPORTING
// ───────────────────────────────────────────────────────────────────────────

// Severity alone decides what alerts. `count` is descriptive and can legitimately be 0
// on a failure (B1 counts recent writes, so a dead importer has count 0).
const summarise = () => ({
  crit: results.filter((r) => r.severity === 'critical'),
  warn: results.filter((r) => r.severity === 'warn'),
})

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildTelegram() {
  const { crit, warn } = summarise()
  const L = [`<b>TennisCuts — Monday audit · ${iso(TODAY)}</b>`]
  L.push(
    crit.length
      ? `🔴 ${crit.length} critical · 🟡 ${warn.length} warnings`
      : warn.length
        ? `🟡 ${warn.length} warnings · no criticals`
        : '✅ All clear'
  )
  for (const r of [...crit, ...warn]) {
    L.push('', `${ICON[r.severity]} <b>${escapeHtml(r.title)}</b> — ${r.count}`)
    for (const row of r.rows.slice(0, 8)) L.push(`· ${escapeHtml(row)}`)
    if (r.rows.length > 8) L.push(`· …and ${r.rows.length - 8} more`)
  }
  const msg = L.join('\n')
  return msg.length > 3900 ? msg.slice(0, 3850) + '\n\n<i>…truncated. See the full report.</i>' : msg
}

function buildMarkdown() {
  const { crit, warn } = summarise()
  const L = [
    '# TennisCuts — Monday audit',
    `_${AS_OF.toISOString()}_ · site: ${SITE} · window: ${iso(WEEK_START)} → ${iso(addDays(WINDOW_END, -1))} · grace: ${GRACE_DAYS}d`,
    '',
    `**${crit.length} critical · ${warn.length} warnings**`,
    '',
  ]
  for (const r of results) {
    L.push(`## ${r.severity === 'info' ? '✅' : ICON[r.severity]} ${r.id} — ${r.title}`)
    L.push(`Count: **${r.count}**`)
    if (r.note) L.push(`> ${r.note}`)
    if (r.rows.length) {
      L.push('')
      for (const row of r.rows.slice(0, 60)) L.push(`- ${row}`)
      if (r.rows.length > 60) L.push(`- …and ${r.rows.length - 60} more`)
    }
    L.push('')
  }
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
  })
  await client.connect()
  // The audit only reads. Enforce it, since CI holds a production connection string.
  await client.query('SET default_transaction_read_only = on')

  let rows
  try {
    rows = await loadEditions(client)
    await runChecks(client, rows)
  } finally {
    await client.end()
  }

  const md = buildMarkdown()
  console.log(md)
  writeFileSync('monday-audit-report.md', md)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)

  if (DRY_RUN) console.log(`\n--- Telegram preview (not sent) ---\n${buildTelegram().replace(/<\/?[bi]>/g, '')}`)
  else await sendTelegram(buildTelegram())

  process.exit(summarise().crit.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
