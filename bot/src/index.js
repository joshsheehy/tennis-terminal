// Entry point. One always-on process that hosts:
//   - a minimal HTTP server receiving Telegram webhooks (idle between messages)
//   - the in-process node-cron daily summary
//
// Webhook mode (not long-polling) keeps CPU/egress minimal on Railway.

import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { config, WEBHOOK_PATH } from './config.js';
import { bot } from './bot.js';
import { startDailySummary } from './summary.js';

// grammY webhook handler for Node's bare http server. It verifies Telegram's
// secret-token header against config.webhookSecret on every request.
const handleUpdate = webhookCallback(bot, 'http', {
  secretToken: config.webhookSecret,
});

const server = createServer(async (req, res) => {
  // Health check / Railway probe.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Telegram webhook deliveries.
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    try {
      await handleUpdate(req, res);
    } catch (err) {
      console.error('webhook handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

async function main() {
  // Initialize the bot (fetches bot info) before serving updates.
  await bot.init();

  // Register the webhook with Telegram so updates flow to our server.
  if (config.publicUrl) {
    const url = `${config.publicUrl}${WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, {
      secret_token: config.webhookSecret,
      allowed_updates: ['message'],
    });
    console.log(`Webhook registered: ${url}`);
  } else {
    console.warn(
      'PUBLIC_URL / RAILWAY_PUBLIC_DOMAIN not set — webhook NOT registered. ' +
        'Set it and redeploy so Telegram can reach the bot.'
    );
  }

  startDailySummary();

  server.listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
