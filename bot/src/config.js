// Centralized config — everything comes from process.env, no hardcoded secrets.
// Throws early on startup if a required variable is missing, so the service
// fails loudly instead of crashing on the first message.

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  nutritionixAppId: required('NUTRITIONIX_APP_ID'),
  nutritionixApiKey: required('NUTRITIONIX_API_KEY'),
  authorizedChatId: required('AUTHORIZED_CHAT_ID'),
  webhookSecret: required('WEBHOOK_SECRET'),

  // Timezone for the daily summary. Single env var so it can be changed while
  // travelling. Node's `TZ` also influences Date, but we compute day ranges
  // explicitly against this value so behavior is deterministic.
  tz: process.env.TZ || 'America/Chicago',

  // SQLite path — MUST be on a Railway volume mounted at /data to survive redeploys.
  dbPath: process.env.DB_PATH || '/data/foodlog.db',

  port: parseInt(process.env.PORT || '3000', 10),

  // Public HTTPS origin Telegram calls. Railway exposes RAILWAY_PUBLIC_DOMAIN
  // (hostname only) once you Generate Domain; allow an explicit override too.
  publicUrl:
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null),

  // The LLM model — multimodal, handles both text fallback and photos.
  model: 'claude-haiku-4-5',
};

// The webhook path doubles as a secret URL segment; Telegram also sends the
// secret token in a header which grammY verifies separately.
export const WEBHOOK_PATH = `/telegram/${config.webhookSecret}`;
