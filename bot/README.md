# Macro Tracker Telegram Bot

A personal, single-user calorie/macro tracking Telegram bot. One always-on
Node.js service, a local SQLite file on a Railway volume, and the fewest
possible paid API calls.

- **grammY** in **webhook mode** — the process stays idle between messages.
- **better-sqlite3** — one file, zero-config, synchronous.
- **claude-haiku-4-5** (multimodal) — text estimates + photo analysis.
- **node-cron** — in-process 9 PM daily summary (no separate cron service).
- **Nutritionix** — free natural-language lookup; the LLM is the fallback.

## How it routes (minimizing paid calls)

For every message (restricted to your `AUTHORIZED_CHAT_ID`):

1. **Text** ("200g chicken breast and a cup of white rice") → Nutritionix
   first (free). Only on a miss does it make **one** `claude-haiku-4-5` call.
2. **Restaurant** ("chicken bowl from Chipotle with rice, black beans, guac") →
   same Nutritionix-first path (its branded DB covers chains). On a miss for a
   local/independent place, **one** LLM call estimates it and flags it as an
   estimate.
3. **Photo** → the image is downscaled to ~768px JPEG, then sent to
   `claude-haiku-4-5`. This is the one path that always makes a paid call.

Estimates are tagged `(estimated)` with the model's assumptions, so you always
know which numbers are looked-up vs guessed.

## Commands

- Send any text or photo of a meal → logged + confirmation + today's total.
- `/today` — today's running total (DB only, no API call).
- `/undo` — delete your most recent entry (DB only, no API call).
- 21:00 in your `TZ` — an unprompted daily summary is pushed to you.

## Local development

```bash
cd bot
cp .env.example .env   # fill in the values
npm install
# For local testing without a public URL, leave PUBLIC_URL unset — the bot
# starts and serves health checks, but Telegram can't reach it until deployed
# (or you tunnel a public HTTPS URL and set PUBLIC_URL).
DB_PATH=./data/foodlog.db npm start
```

## Railway setup (this is the third service in the repo)

1. **New service → Deploy from repo**, set the **root directory** to `bot/`
   (so it builds independently of the Next.js app).
2. **Attach a Volume mounted at `/data`.** This is what makes the SQLite file
   survive redeploys. (`DB_PATH` defaults to `/data/foodlog.db`.)
3. **Generate Domain** on the service to get the public HTTPS URL. Railway
   exposes it as `RAILWAY_PUBLIC_DOMAIN`, which the bot reads automatically —
   or set `PUBLIC_URL` explicitly.
4. **Set the environment variables** (see `.env.example`):
   `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `NUTRITIONIX_APP_ID`,
   `NUTRITIONIX_API_KEY`, `AUTHORIZED_CHAT_ID`, `WEBHOOK_SECRET`, `TZ`.
   Set `WEBHOOK_SECRET` to any random string.
5. Deploy. On startup the bot registers its webhook with Telegram
   (`https://<your-domain>/telegram/<WEBHOOK_SECRET>`) and schedules the 9 PM
   summary.

> The build command is `npm install` (native modules `better-sqlite3` and
> `sharp` compile during install); the start command is `npm start`.

## Finding your AUTHORIZED_CHAT_ID

The bot logs the chat id of any **unauthorized** message. So:

1. Set every env var except give `AUTHORIZED_CHAT_ID` a placeholder and deploy.
2. Message your bot once.
3. Check the Railway logs — you'll see
   `Ignoring message from unauthorized chat id: <number>`.
4. Put that number in `AUTHORIZED_CHAT_ID` and redeploy.

(Or message [@userinfobot](https://t.me/userinfobot), which replies with your id.)

## Storage

SQLite table `food_log`:

| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | autoincrement |
| chat_id | TEXT | |
| ts | INTEGER | unix ms, UTC |
| source | TEXT | `text` / `restaurant` / `photo` |
| raw_input | TEXT | original message |
| items_json | TEXT | per-item breakdown |
| kcal, protein_g, carbs_g, fat_g | REAL | meal totals |
| estimated | INTEGER | 0/1 |
