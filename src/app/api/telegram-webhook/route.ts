import { NextRequest, NextResponse } from 'next/server';
import { replyFor } from '@/lib/telegram-reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Answers messages sent to the tenniscuts.com bot ("status", "open", ...)
// the moment Telegram delivers them, instead of on GitHub Actions' schedule.
//
// WHY THIS REPLACES THE POLLER: the original design (see PLAYBOOK.md, and
// the retired .github/workflows/telegram-poll.yml) deliberately chose a
// 5-minute cron poll over a webhook, reasoning that polling needed no new
// public endpoint and accepting "replies landing on a five-minute cadence
// instead of instantly" as the cost. That tradeoff turned out not to hold:
// checked the poller's actual run history and it was firing every 2-5 HOURS,
// not every 5 minutes — GitHub does not treat a `*/5 * * * *` schedule as a
// promise, especially on a repo already running several other scheduled
// workflows, and does not document by how much it can slip. A user
// message could sit unanswered for hours. That is the "takes over an hour to
// answer" this route exists to fix.
//
// SECURITY, now that this is a new public route: Telegram signs every
// webhook delivery with whatever secret_token was given to setWebhook, sent
// back as the X-Telegram-Bot-Api-Secret-Token header. Checked below against
// TELEGRAM_WEBHOOK_SECRET before anything else runs — this is Telegram's own
// documented mechanism for exactly this, not something bolted on. This route
// is also carved out of src/middleware.ts's admin-secret gate (Telegram can't
// supply our ADMIN_SECRET), so this check is the only thing standing between
// the public internet and a reply. A request that fails it gets a bare 401
// and nothing else runs.
//
// Telegram allows exactly one active consumer of a bot's updates — setting
// this webhook is what makes the old poller's getUpdates calls start
// returning 409 if that workflow is ever reinstated. Do not run both.
//
// One-time setup: POST to
//   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
//     ?url=https://tenniscuts.com/api/telegram-webhook
//     &secret_token=<TELEGRAM_WEBHOOK_SECRET>
// TELEGRAM_WEBHOOK_SECRET must be set to the same value here (Railway) and
// wherever setWebhook is called from — see
// .github/workflows/register-telegram-webhook.yml, which does this from a
// GitHub secret so the token is never typed anywhere by hand.

type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number | string } };
};

async function sendMessage(token: string, chatId: number | string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
  if (!j.ok) console.error(`[telegram-webhook] sendMessage failed: ${JSON.stringify(j).slice(0, 200)}`);
}

export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = request.headers.get('x-telegram-bot-api-secret-token');
  if (!expected || supplied !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChat = process.env.TELEGRAM_CHAT_ID;

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    // Always 200 a delivery we can't use — Telegram retries on non-2xx,
    // and a malformed body will never parse differently on retry.
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  if (!msg?.text || msg.chat?.id == null) return NextResponse.json({ ok: true });

  // The allowlist: a message from any other chat is silently dropped rather
  // than answered, so finding the bot on Telegram doesn't hand a stranger a
  // read of the case ledger.
  if (!token || !allowedChat || String(msg.chat.id) !== String(allowedChat)) {
    return NextResponse.json({ ok: true });
  }

  try {
    await sendMessage(token, msg.chat.id, await replyFor(msg.text));
  } catch (err) {
    // Reply failures still 200 — Telegram would otherwise retry the same
    // update, which could double-send once whatever failed clears up.
    console.error('[telegram-webhook]', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}
