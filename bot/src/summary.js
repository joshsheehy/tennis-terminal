// In-process daily summary. node-cron fires at 21:00 in config.tz; one always-on
// service covers both message handling and this scheduled push (no separate
// Railway cron service).

import cron from 'node-cron';
import { config } from './config.js';
import { bot } from './bot.js';
import { sumRange } from './db.js';
import { localDayRange } from './time.js';
import { formatDailySummary } from './format.js';

export function startDailySummary() {
  // '0 21 * * *' = every day at 21:00, interpreted in config.tz.
  cron.schedule(
    '0 21 * * *',
    async () => {
      try {
        const { startMs, endMs } = localDayRange(config.tz);
        const today = sumRange(config.authorizedChatId, startMs, endMs);
        await bot.api.sendMessage(
          config.authorizedChatId,
          formatDailySummary(today)
        );
      } catch (err) {
        console.error('daily summary error:', err);
      }
    },
    { timezone: config.tz }
  );

  console.log(`Daily summary scheduled for 21:00 ${config.tz}`);
}
