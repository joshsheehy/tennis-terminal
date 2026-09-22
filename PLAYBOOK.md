# The audit → boss → you pipeline

Three layers, each escalating only what the one before it couldn't handle:

1. **The audit** (`scripts/monday-audit.mjs`) finds problems. It never fixes anything.
2. **The boss** (`scripts/boss/orchestrate.mjs`) tries a fixed, deterministic remedy for the problems it
   knows how to fix, using the same admin API a person would. Nothing else. No LLM, no shell access, no
   free-form code changes.
3. **You**, on Telegram — only for what the boss couldn't fix, and only once.

Everything in between lives in the case ledger: a database table (`agent_cases`, `sql/018`), not a file in
the repo, because it changes every run and several things write to it. `src/lib/agent-cases.ts` is the only
code that touches it.

## Why the boss has no AI in it

The original idea for this was a second, more powerful agent — headless Claude Code, given edit access and
a Bash tool, reviewing findings and fixing them like an employee reporting to a boss. Building it surfaced
a real problem: Claude Code's `--allowedTools "Bash(cmd *)"` allowlist is a prefix match on the literal
shell string, not a sandbox. In testing, `node scripts/boss/tools.mjs case 1; cat secret.txt` and
`... && cat secret.txt` both ran the second command — a semicolon or `&&` after an allowed prefix gets
through. `Edit(/path)` rules *do* enforce correctly (only the named file can be touched), but the moment a
tool-using agent has Bash at all — even "restricted" to one wrapper script — a hostile or merely
overconfident agent, or a tournament name with the wrong text in it, can run anything.

So v1 has no tool-using agent. Every fix the boss can make was one the audit could already point at exactly
what to do, from data it already had — which turned out to be every fix worth automating anyway:

| Check | Remedy | Why it's safe to automate |
|---|---|---|
| `V1` (stored cut disagrees with its sheet) | re-import that exact sheet | the audit already fetched and parsed it to find the disagreement; the URL and the correct slug/year/event/draw come from the finding itself |
| `A1`/`A2`, cause = "posted" | re-import the singles main sheet | the audit's own `probeSheet` already confirmed the sheet exists at that URL |
| `C1` (impossible cut value) | `/api/cleanup-anomalous-cuts?apply=true` | a global sweep the app already exposes; re-running it is idempotent |

Everything else — a missing PTL code, a duplicate to merge, a surface override, a pipeline outage, a
certificate expiring — goes straight to `escalated`. Each of those needs either a live web search
(`ptl-code-overrides.ts`'s own header explains why probing codes doesn't scale and atptour.com 403s
runners) or a human judgment call the user has made by hand before (Plovdiv's surface override was kept for
the *wrong* clay edition on purpose; Hamburg's was a explicit rule, not a mechanical "most history" pick).
Teaching a script to guess those is how the byes/anomaly bugs earlier in this project's history happened in
the first place — a plausible-looking number, trusted without a check.

If a genuine judgment case is ever worth automating, the right shape is a plain `fetch` to the Anthropic
Messages API with no tools at all — text in, a small JSON verdict out, validated by the orchestrator before
it acts on it — never a tool-using agent with edit or shell access. Nothing in v1 needs that yet.

## The lifecycle of a case

```
audit finds it  →  open  →  boss attempts it (max 2)  →  fixed (if the audit stops finding it)
                                                       →  escalated (if it has no remedy, or runs out of attempts)
```

- `syncFindings` (`src/lib/agent-cases.ts`) opens a case per new finding key, refreshes ones already open,
  reopens ones that had been marked fixed and came back, and marks fixed anything an already-*ran* check no
  longer reports. A case only closes because the audit stopped finding it — the boss never marks its own
  work "fixed" for anything that needs a deploy to take effect (there is nothing like that in v1, but the
  design leaves room for it: a registry-file edit would need this same discipline).
- `MAX_ATTEMPTS` is 2 (`src/lib/agent-cases.ts`). A case that fails twice — or that had no remedy at
  all — is escalated and the user is notified once (`notified_at`), with a reminder every 7 days
  (`casesToTellUser`) while it stays open.
- Every remedy the boss tries logs to `agent_case_events`, so `SELECT * FROM agent_case_events WHERE
  case_id = ...` (or asking the bot) shows exactly what was attempted and why it didn't stick.

## Guardrails (`src/lib/boss-policy.ts`)

Even though v1 never gives the boss a tool-using agent, the policy module exists because it's the one
place all of this is written down and tested, and because it's what a future judgment-call remedy (see
above) would be checked against before it's allowed to act:

- `judgeAdminCall` — the only admin routes anything is allowed to call, and only with the query shape those
  routes actually expect (an import needs a real ProTennisLive/Wayback sheet URL; the admin key is always
  added by the caller, never accepted as a parameter).
- `isSheetUrl` — a draw-sheet URL must be `protennislive.com/posting/<year>/<code>/(mds|qs|mdd).pdf`, live or
  through `web.archive.org`. Nothing else is fetched.
- `disallowedChanges` / `diffTooLarge` — if this project ever does give an agent `Edit` access to the three
  small registry files (`ptl-code-overrides.ts`, `surface-overrides.ts`, `tournament-aliases.ts`), these
  are what would keep a change small and on-target before it's committed.
- `leaksSecret` — refuses to publish text containing a configured secret's actual value.

## Talking to it on Telegram

`scripts/telegram-bot.mjs`, polled every 5 minutes by `.github/workflows/telegram-poll.yml`. Not a webhook:
Telegram allows only one active consumer of a bot's updates, this repo is public, and a webhook would need
an unauthenticated route on the live site (`/api/telegram-webhook`) with its own secret-token and chat-id
checks. Polling needs neither — no new endpoint, no new attack surface — at the cost of replies landing on
a five-minute cadence instead of instantly.

Every reply is a lookup (`ledgerSummary`, `listCases`), never a model call:

- "status" / "resolved?" / "any progress" → what's fixed in the last 7 days, what's escalated, when the
  audit last ran.
- "open" / "list" / "cases" → what's open right now.
- anything else → a one-line reminder of those two.

Only messages from `TELEGRAM_CHAT_ID` get a reply (others are read, to keep the update offset moving, but
never answered) — so finding the bot on Telegram doesn't hand a stranger a read of the case ledger.

## Setup

One new secret beyond what the audit already needs: **`ADMIN_SECRET`**, the same value already configured
as the app's admin API key (Railway → your Next.js service → Variables → `ADMIN_SECRET`). Add it as a
GitHub repository secret with that exact value. Nothing else changes — `DATABASE_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` are all already in place from the Monday audit setup.
