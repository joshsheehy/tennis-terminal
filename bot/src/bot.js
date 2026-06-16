// grammY bot setup: access control, message routing, and commands.
// Runs in webhook mode (wired up in index.js) so the process stays idle
// between messages.

import { Bot } from 'grammy';
import { config } from './config.js';
import { routeText, routePhoto } from './router.js';
import { insertEntry, sumRange, deleteLatest } from './db.js';
import { localDayRange } from './time.js';
import { formatLogReply, formatToday } from './format.js';

export const bot = new Bot(config.telegramBotToken);

// ── Access control ────────────────────────────────────────────────────────
// The bot is publicly reachable by its token, so lock every update to the one
// authorized chat. Anyone else is silently ignored.
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (String(chatId) !== String(config.authorizedChatId)) {
    if (chatId != null) {
      // Log so you can discover your own chat id on first message.
      console.log(`Ignoring message from unauthorized chat id: ${chatId}`);
    }
    return; // silently drop
  }
  return next();
});

function todayTotal(chatId) {
  const { startMs, endMs } = localDayRange(config.tz);
  return sumRange(chatId, startMs, endMs);
}

// ── Commands (DB-only, no API calls) ────────────────────────────────────────
bot.command('start', (ctx) =>
  ctx.reply(
    'Macro tracker ready. Send me what you ate (text or a photo).\n' +
      'Commands: /today (running total), /undo (remove last entry).'
  )
);

bot.command('today', (ctx) => ctx.reply(formatToday(todayTotal(ctx.chat.id))));

bot.command('undo', (ctx) => {
  const removed = deleteLatest(ctx.chat.id);
  if (!removed) return ctx.reply('Nothing to undo.');
  return ctx.reply(`Removed your last entry.\n${formatToday(todayTotal(ctx.chat.id))}`);
});

// ── Photo messages → vision path ────────────────────────────────────────────
bot.on('message:photo', async (ctx) => {
  try {
    // ctx.getFile() resolves the largest available photo size and its
    // file_path. We downscale it ourselves before the paid vision call.
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());

    const { source, parsed } = await routePhoto(buffer, ctx.message.caption);
    insertEntry({
      chatId: ctx.chat.id,
      source,
      rawInput: ctx.message.caption || '[photo]',
      parsed,
    });
    await ctx.reply(formatLogReply(parsed, todayTotal(ctx.chat.id)));
  } catch (err) {
    console.error('photo handler error:', err);
    await ctx.reply("Sorry, I couldn't read that photo. Try again or describe the meal in text.");
  }
});

// ── Text messages → Nutritionix-first path ──────────────────────────────────
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text) return;
  try {
    const { source, parsed } = await routeText(text);
    insertEntry({ chatId: ctx.chat.id, source, rawInput: text, parsed });
    await ctx.reply(formatLogReply(parsed, todayTotal(ctx.chat.id)));
  } catch (err) {
    console.error('text handler error:', err);
    await ctx.reply("Sorry, I couldn't log that. Please try rephrasing the meal.");
  }
});

// Catch-all so a bad message never crashes the process.
bot.catch((err) => {
  console.error('bot error:', err);
});
