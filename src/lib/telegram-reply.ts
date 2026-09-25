// What to say back to a Telegram message — a lookup against the case ledger,
// never a model call, so "has it been resolved?" gets a cheap, honest,
// instant answer instead of a guess. Shared by the webhook route
// (src/app/api/telegram-webhook/route.ts), which is the only caller now.
//
// Moved out of scripts/telegram-bot.mjs when that script (and the 5-minute
// poller that ran it, .github/workflows/telegram-poll.yml) was retired — see
// the webhook route's own header for why.

import { ledgerSummary, listCases } from './agent-cases';
import { intentFor } from './telegram-intent';

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function ageDays(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
}
function fmt(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

async function statusReply(): Promise<string> {
  const s = await ledgerSummary();
  const open = (s.counts.open ?? 0) + (s.counts.in_progress ?? 0);
  const escalated = s.counts.escalated ?? 0;
  const lines = [
    escalated
      ? `🔴 ${escalated} need${escalated === 1 ? 's' : ''} you`
      : open
        ? `🟡 ${open} open — the boss is working ${open === 1 ? 'it' : 'them'}`
        : '🟢 everything is resolved',
    `Fixed in the last 7 days: ${s.fixedRecently}.`,
    s.lastAuditAt ? `Last audit check: ${esc(fmt(s.lastAuditAt))} UTC.` : 'No audit has run yet.',
  ];
  if (escalated) {
    const { cases } = await listCases({ status: ['escalated'], limit: 8 });
    lines.push('');
    for (const c of cases) {
      lines.push(`· ${esc(c.title)} (open ${ageDays(c.first_seen)}d) — ${esc(c.resolution ?? 'could not fix it automatically')}`);
    }
  }
  return lines.join('\n');
}

async function listReply(): Promise<string> {
  const { counts, cases } = await listCases({ status: ['open', 'in_progress', 'escalated'], limit: 12 });
  if (!cases.length) return '🟢 nothing open right now.';
  const lines = [`open ${counts.open ?? 0} · in progress ${counts.in_progress ?? 0} · escalated ${counts.escalated ?? 0}`, ''];
  for (const c of cases) lines.push(`${c.status === 'escalated' ? '🔴' : '🟡'} ${esc(c.title)} — ${esc(c.key)}`);
  return lines.join('\n');
}

const HELP = [
  'I watch tenniscuts.com for missing or wrong cuts and try to fix what I find.',
  '',
  'Ask me:',
  '· “status” or “has it been resolved?” — what’s fixed, what’s waiting on you',
  '· “open” or “list” — what’s open right now',
].join('\n');

export async function replyFor(text: string): Promise<string> {
  const intent = intentFor(text);
  if (intent === 'status') return statusReply();
  if (intent === 'list') return listReply();
  return HELP;
}
