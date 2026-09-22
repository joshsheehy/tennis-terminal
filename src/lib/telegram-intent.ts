// What the Telegram poller (scripts/telegram-bot.mjs) does with an inbound message: a fixed set of
// intents answered by a ledger lookup, never an LLM call — "has it been resolved?" should be a cheap,
// honest, instant answer, not something a model can hallucinate.

export type Intent = 'status' | 'list' | 'help';

export function intentFor(text: string): Intent {
  const t = text.trim().toLowerCase();
  if (/\b(open|list|cases|todo)\b/.test(t)) return 'list';
  if (/^\/?(status|start)\b/.test(t) || /\b(resolv|fix|done|progress)/.test(t)) return 'status';
  return 'help';
}
