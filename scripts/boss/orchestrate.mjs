#!/usr/bin/env node
/**
 * The "boss": works the case ledger's open cases, one deterministic remedy at a time (see
 * src/lib/boss-remedies.ts and PLAYBOOK.md), then tells the user on Telegram about whatever it could
 * not fix. No LLM, no shell access, no free-form code changes — every action here is a call the app's own
 * admin API already exposes, gated by src/lib/boss-policy.ts. Run through tsx:
 *
 *   npx tsx scripts/boss/orchestrate.mjs
 *
 * Needs DATABASE_URL (write access — the ledger lives in the same database as the cuts), ADMIN_SECRET
 * (to call the admin API), SITE_URL (default https://tenniscuts.com), and optionally
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID to notify the user about escalations.
 *
 * Exits 1 when any case is left in the `escalated` state (nothing to do with whether this run's own
 * attempts succeeded) — a scheduled run should go red exactly when the user has something to look at,
 * the same rule the audit itself uses for criticals.
 */
import { casesForBoss, updateCase, escalateExhausted, casesToTellUser } from '../../src/lib/agent-cases.ts'
import { remedyFor } from '../../src/lib/boss-remedies.ts'
import { MAX_MUTATIONS_PER_RUN } from '../../src/lib/boss-policy.ts'
import { pool } from '../../src/lib/db.ts'

const SITE = (process.env.SITE_URL || 'https://tenniscuts.com').replace(/\/$/, '')
const ADMIN_SECRET = process.env.ADMIN_SECRET

if (!ADMIN_SECRET) {
  console.error('ADMIN_SECRET is not set. The boss calls the same admin API the workflows use; set it as a repository secret.')
  process.exit(2)
}

async function adminGet(path, query = {}) {
  const url = new URL(SITE + path)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  let res
  try {
    res = await fetch(url, { headers: { 'x-admin-secret': ADMIN_SECRET }, signal: AbortSignal.timeout(45000) })
  } catch (e) {
    return { ok: false, json: { error: e.message } }
  }
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok && json?.ok !== false, json }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Returns whether the message actually reached the user, so callers don't mark something "notified" that wasn't. */
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send.')
    return false
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  const j = await res.json().catch(() => ({}))
  console.log(`[telegram] ${res.status} ${j.ok ? 'sent' : JSON.stringify(j).slice(0, 200)}`)
  return res.ok && j.ok === true
}

async function tryFix(row) {
  const remedy = remedyFor(row)
  await updateCase({ id: row.id, actor: 'boss', attempt: true, note: `remedy: ${remedy.kind}` })

  if (remedy.kind === 'none') {
    await updateCase({ id: row.id, actor: 'boss', status: 'escalated', note: remedy.reason })
    console.log(`#${row.id} (${row.key}) escalated: ${remedy.reason}`)
    return
  }

  if (remedy.kind === 'cleanup-anomalies') {
    const { ok, json } = await adminGet('/api/cleanup-anomalous-cuts', { apply: 'true' })
    console.log(`#${row.id} (${row.key}) ran the anomaly cleanup sweep: ${ok ? 'ok' : 'failed'} ${JSON.stringify(json).slice(0, 200)}`)
    // Left in_progress: whether THIS row is now clean is for the next audit run to confirm.
    return
  }

  // remedy.kind === 'reimport'
  const { ok, json } = await adminGet('/api/import-pdf-direct', {
    url: remedy.url,
    slug: remedy.slug,
    year: remedy.year,
    event: remedy.event,
    draw: remedy.draw,
  })
  const fixed = ok && (json.hasRank || json.hasByes) && !json.anomalyRejected
  if (fixed) {
    await updateCase({ id: row.id, actor: 'boss', status: 'fixed', note: `Re-imported ${remedy.url}.` })
    console.log(`#${row.id} (${row.key}) fixed: re-imported ${remedy.url}`)
  } else {
    console.log(`#${row.id} (${row.key}) re-import did not resolve it: ${JSON.stringify(json).slice(0, 300)}`)
  }
}

async function main() {
  const cases = await casesForBoss()
  console.log(`${cases.length} case(s) for the boss`)

  const anomalyCases = cases.filter((c) => c.check_id === 'C1')
  const rest = cases.filter((c) => c.check_id !== 'C1')
  // The cleanup sweep fixes every anomalous row in one call; running it once covers every C1 case in this batch.
  if (anomalyCases.length) await tryFix(anomalyCases[0])
  for (const row of anomalyCases.slice(1)) {
    await updateCase({ id: row.id, actor: 'boss', attempt: true, note: 'covered by this run’s anomaly cleanup sweep' })
  }
  for (const row of rest.slice(0, MAX_MUTATIONS_PER_RUN)) {
    await tryFix(row)
  }

  const exhausted = await escalateExhausted('boss')
  if (exhausted.length) console.log(`${exhausted.length} case(s) escalated after running out of attempts`)

  const { fresh, reminders } = await casesToTellUser()
  if (fresh.length || reminders.length) {
    const lines = ['<b>TennisCuts — needs you</b>', '']
    for (const c of fresh) {
      lines.push(`🔴 <b>${esc(c.title)}</b>`, esc(c.detail), esc(c.resolution ?? `Tried ${c.attempts} time(s); could not fix it automatically.`), '')
    }
    for (const c of reminders) {
      lines.push(`⏳ still open (${Math.round((Date.now() - new Date(c.first_seen).getTime()) / 86400000)}d): <b>${esc(c.title)}</b>`, esc(c.detail), '')
    }
    lines.push('Reply on this chat any time to ask what is open.')
    const sent = await sendTelegram(lines.join('\n').trim())
    if (sent) for (const c of [...fresh, ...reminders]) await updateCase({ id: c.id, actor: 'boss', markNotified: true })
  } else {
    console.log('nothing new to tell the user')
  }

  const remaining = await pool.query(`select count(*)::int as n from agent_cases where status = 'escalated'`)
  await pool.end()
  process.exit((remaining.rows[0]?.n ?? 0) > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
