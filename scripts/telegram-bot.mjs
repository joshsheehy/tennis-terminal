#!/usr/bin/env node
/**
 * Answers messages sent to the existing Telegram bot with a lookup against the case ledger — no LLM
 * involved, so "has it been resolved?" gets a cheap, honest, instant answer instead of a guess.
 *
 * Runs on a short cron (see .github/workflows/telegram-poll.yml) rather than as a long-lived process:
 * GitHub Actions has no "stay running and wait for a message" job type, so this asks Telegram's getUpdates
 * for whatever arrived since the last run and replies to it, then exits. The offset that makes that
 * possible lives in the same database as the ledger (agent_kv; see src/lib/agent-cases.ts) since a cron
 * run remembers nothing on its own.
 *
 * Telegram allows exactly one active consumer of a bot's updates. If this bot is ever given a webhook
 * instead, getUpdates starts returning 409 and this script goes quiet — do not run both at once.
 *
 *   npx tsx scripts/telegram-bot.mjs
 *
 * Needs DATABASE_URL (write), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. TELEGRAM_CHAT_ID is also the
 * allowlist: a message from any other chat is read (so the offset still advances) but never answered,
 * so the bot can't be walked into leaking case data by someone else who finds it on Telegram.
 */
import { getTelegramOffset, ledgerSummary, listCases, setTelegramOffset } from '../src/lib/agent-cases.ts'
import { intentFor } from '../src/lib/telegram-intent.ts'
import { pool } from '../src/lib/db.ts'

const token = process.env.TELEGRAM_BOT_TOKEN
const allowedChat = process.env.TELEGRAM_CHAT_ID
if (!token || !allowedChat) {
  console.log('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — nothing to poll.')
  process.exit(0)
}
// Overridable so this script can be pointed at a stand-in server in a test; production never sets this.
const API = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '')

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ageDays = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))
const fmt = (iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ')

async function statusReply() {
  const s = await ledgerSummary()
  const open = (s.counts.open ?? 0) + (s.counts.in_progress ?? 0)
  const escalated = s.counts.escalated ?? 0
  const lines = [
    escalated
      ? `🔴 ${escalated} need${escalated === 1 ? 's' : ''} you`
      : open
      ? `🟡 ${open} open — the boss is working ${open === 1 ? 'it' : 'them'}`
      : '🟢 everything is resolved',
    `Fixed in the last 7 days: ${s.fixedRecently}.`,
    s.lastAuditAt ? `Last audit check: ${esc(fmt(s.lastAuditAt))} UTC.` : 'No audit has run yet.',
  ]
  if (escalated) {
    const { cases } = await listCases({ status: ['escalated'], limit: 8 })
    lines.push('')
    for (const c of cases) lines.push(`· ${esc(c.title)} (open ${ageDays(c.first_seen)}d) — ${esc(c.resolution ?? 'could not fix it automatically')}`)
  }
  return lines.join('\n')
}

async function listReply() {
  const { counts, cases } = await listCases({ status: ['open', 'in_progress', 'escalated'], limit: 12 })
  if (!cases.length) return '🟢 nothing open right now.'
  const lines = [`open ${counts.open ?? 0} · in progress ${counts.in_progress ?? 0} · escalated ${counts.escalated ?? 0}`, '']
  for (const c of cases) lines.push(`${c.status === 'escalated' ? '🔴' : '🟡'} ${esc(c.title)} — ${esc(c.key)}`)
  return lines.join('\n')
}

const HELP = [
  'I watch tenniscuts.com for missing or wrong cuts and try to fix what I find.',
  '',
  'Ask me:',
  '· “status” or “has it been resolved?” — what’s fixed, what’s waiting on you',
  '· “open” or “list” — what’s open right now',
].join('\n')

async function replyFor(text) {
  const intent = intentFor(text)
  if (intent === 'status') return statusReply()
  if (intent === 'list') return listReply()
  return HELP
}

async function send(chatId, text) {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  const j = await res.json().catch(() => ({}))
  if (!j.ok) console.log(`[telegram] send failed: ${JSON.stringify(j).slice(0, 200)}`)
}

async function main() {
  const offset = await getTelegramOffset()
  const qs = new URLSearchParams({ offset: String(offset), timeout: '0', allowed_updates: '["message"]' })
  const res = await fetch(`${API}/bot${token}/getUpdates?${qs}`)
  const data = await res.json()
  if (!data.ok) {
    console.error(`getUpdates failed: ${JSON.stringify(data).slice(0, 300)}`)
    await pool.end()
    // 409 = something else (a webhook) is already consuming this bot's updates.
    process.exit(data.error_code === 409 ? 1 : 2)
  }

  let maxId = offset - 1
  for (const u of data.result) {
    maxId = Math.max(maxId, u.update_id)
    const msg = u.message
    if (!msg?.text) continue
    if (String(msg.chat.id) !== String(allowedChat)) {
      console.log(`ignored a message from an unrecognised chat ${msg.chat.id}`)
      continue
    }
    await send(msg.chat.id, await replyFor(msg.text))
    console.log(`replied to "${msg.text.slice(0, 60)}"`)
  }
  if (maxId >= offset) await setTelegramOffset(maxId + 1)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
