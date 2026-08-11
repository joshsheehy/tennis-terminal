# ATP entry-list source research

Last updated: 2026-08-11

This note records the source work already completed for full ATP/Challenger acceptance-list tracking so we do not repeat dead-end probes.

## Product requirement

TennisCuts needs the ordered pre-draw list, not only a cutoff number:

- singles main and qualifying
- doubles main when available
- direct acceptances and the complete ordered alternate queue
- ATP player id, name, nationality and ranking
- entry/status code (PR, NG, JR, WC, SE, etc.)
- snapshots over time so an alternate can be tracked from ALT N to DA
- literal `Original Cut Off`, `Ranking Date` and report/list date when an official source exposes them

Never infer `Original Cut Off` from the lowest-ranked main-list player. Special entry categories can make that wrong.

## Static ProTennisLive PDFs: not the source

The public `protennislive.com/posting/{year}/{code}/` directory has been exhaustively tested for acceptance-list filenames. A one-to-three-letter filename sweep (18,278 candidates) found no hidden entry-list document. The useful public files are draw/detail assets such as `mds.pdf`, `mdd.pdf`, `qs.pdf`, `qd.pdf` and `ds.pdf`; they are not the pre-draw acceptance list.

Do not repeat filename brute forcing on this host.

## Official ProTennisLive PlayerList API: correct structured source, authenticated

Official Swagger:

`https://api.protennislive.com/feeds/swagger/index.html`

The `orgclient` contract exposes:

`GET /PlayerList/{tournamentYear}/{tournamentId}`

The documented response is a `TournamentPlayerList`. Each tournament list contains:

- `MainQualyDrawType` (`M` or `Q`)
- `IsDoubles`
- `PlayerListType` (original acceptance list versus draw)
- ordered `PlayerList`

Each `PlayerListItem` includes fields useful to TennisCuts, including:

- `PlayerId`
- `FirstName`, `LastName`
- `NatlCode`
- `RankRoll`
- `Seed`
- `EntryCode`
- `Alternate`
- `PartnerId`

This is the closest known official structured source to the full acceptance-list product requirement. Preserve the API's array order; derive alternate queue position from the order of `Alternate=true` rows, never by re-sorting on ranking.

Direct unauthenticated requests return HTTP 401. Swagger declares Bearer authorization. A clean unauthenticated request returns `WWW-Authenticate: Bearer`; a deliberately invalid token returns Bearer `invalid_token`. `OPTIONS` is also authenticated, and neither the host root nor `/feeds` exposes a usable public OpenID discovery document. There is therefore no evidence of a self-service/public token issuer hidden behind standard OIDC discovery.

We must not bypass that requirement or automate a logged-in PlayerZone session.

ATP's Tournament Data Form publicly directs tournament developers to the `tournamentclient` Swagger and states that development teams requiring tokens should contact Bram Tukker at `bram.tukker@atptour.com`. That establishes a legitimate token-request path.

ATP's current website Terms & Conditions also prohibit systematic retrieval to build a database without prior express written permission. A production access request therefore needs both technical authorization and clear storage/display permission; a technically reachable endpoint alone is not enough.

## All officially advertised ProTennisLive client contracts inspected

The public Swagger UI advertises six client contracts. All six were inspected on 2026-08-11 rather than guessing hidden API names:

| Contract | Relevant routes | Entry-list value |
| --- | --- | --- |
| `orgclient` | `/PlayerList/{year}/{id}` plus calendar/ranks/draws/results | **Best fit.** Multi-tournament, code-driven PlayerList feed. Bearer required. |
| `tournamentclient` | `/PlayerList` plus tournament-scoped draws/results/schedules | Same PlayerList schema, but tournament identity comes from token claims. Several routes explicitly require Tournament Claims. Not scalable without ATP-issued scope. |
| `playerclient` | player profile/results/ranks | No acceptance-list route. |
| `playersensitiveclient` | `/PzPlayerSensitive` | Sensitive PlayerZone player data. Out of scope and must not be used for this project. |
| `draftclient` | WTA draft order-of-play routes | Irrelevant. |
| `integrations` | packet delivery reporting | Irrelevant. |

No advertised client exposes a second public acceptance-list endpoint, an ECEAS replacement, or a route containing literal `Original Cut Off` / acceptance-list `Ranking Date` / report publication date.

The result narrows the central-source problem substantially: **`orgclient /PlayerList/{year}/{id}` is the official ATP feed we should pursue.** There is no evidence that further endpoint-name guessing will reveal a public equivalent.

## PlayerList metadata gap

The documented PlayerList schema does **not** expose these acceptance-report header fields:

- literal `Original Cut Off`
- acceptance-list `Ranking Date`
- report/list publication date

`/Ranks/rankdate` is only the current global ATP ranking date and must not be substituted for the acceptance-list ranking date.

Do not synthesize those fields from PlayerList contents. Ask ATP/TDI whether an acceptance-report/ECEAS-equivalent field or additional authorized contract exposes them.

## PlayerZone report routes

The modern report hostname `ps-site.atppz.com` currently resolves in public DNS to `10.80.3.20`, an RFC1918 private address. It is therefore not a generally reachable public web source from GitHub Actions or Railway. Do not keep treating timeouts from this host as a URL-guessing problem.

The older ECEAS report family generated the exact PDF style TennisCuts wants (Official Player Acceptance List, Original Cut Off, Ranking Date, numbered Alternates), but current unauthenticated access to the legacy PlayerZone report service is authorization-gated.

Do not automate PlayerZone credentials, cookies, sessions or authentication workarounds.

## ATP public website / app route

The public ATP tournament frontend exposes a promotional `Who is Playing` roster, but the observed public page model does not expose the complete alternate queue, `EntryCode`, or acceptance-report metadata required here. Direct same-origin API guesses were blocked by the site's edge protection and no public PlayerList plumbing was found in indexed content.

This avenue can remain a passive discovery target if ATP later publishes richer pre-draw data, but it is not currently a substitute for `orgclient` PlayerList.

## Third-party hub experiment

The temporary centralized third-party parser/sync experiment has been removed from application code. It is not part of the production source architecture. The old database migration can remain as harmless migration history, but no active workflow depends on it.

## Aug. 17, 2026 pilot week

These ATP Challenger tournament IDs are already known and are ideal for an official-feed acceptance-list pilot:

- Kingston 1 — `3121`
- Prague — `600`
- Roehampton 1 — `3123`
- Sion — `3133`
- Cancun — `3009`
- Quebec City — `3103`

Unauthenticated `orgclient /PlayerList/2026/{id}` calls for these events return HTTP 401, as expected from the documented bearer requirement.

If ATP supplies appropriate read-only orgclient access, this week can be imported without regional-site discovery: six code-based requests per sync cycle, compact normalized hashes, and database writes only when a list changes.

## Official access paths to pursue

1. **ATP ProTennisLive orgclient access** — request read-only access to `/PlayerList/{year}/{tournamentId}` across ATP Tour and Challenger, using the existing ATP numeric tournament IDs as the key.
2. **Tennis Data Innovations (TDI)** — TDI centrally manages/commercializes ATP data and advertises a Tennis Data Platform sandbox for third-party innovation. Ask whether acceptance/player-list data is available there and what storage/display rights apply.
3. **Champion Data / TDI platform** — Champion Data operates the TDI platform and is a secondary formal route for platform/API access questions.

The access request should explicitly describe TennisCuts as a non-betting player tournament-planning utility with low-volume, cached, read-only usage and request the following fields/rights:

- tournament year/id
- main vs qualifying
- singles vs doubles
- `PlayerListType`
- stable published player order
- PlayerId/name/nationality/rank
- `EntryCode`
- `Alternate`
- literal Original Cut Off
- acceptance-list Ranking Date
- list/report date
- permission to cache revision snapshots and display current alternate position/movement to players
- rate limits, token scope, expiry and renewal method

A prepared request is in `docs/atp-playerlist-access-request.md`.

## Code already prepared

`src/lib/protennis-player-list.ts` is an official PlayerList adapter that only works when a legitimately issued bearer token is explicitly supplied. It contains no PlayerZone credential/session automation or bypass logic.

`src/lib/protennis-player-list.test.ts` verifies that published order is preserved, alternate positions are derived from that order, and cutoff/ranking-date metadata is not invented.

`src/app/api/sync-protennis-player-lists/route.ts` is the protected week-level importer. It derives ATP tournament codes from the same code infrastructure used by historical cut imports, calls only the official PlayerList endpoint, stores a new compact snapshot only when the normalized list hash changes, and refuses to run unless `PROTENNISLIVE_TOKEN` is configured.

`.github/workflows/entry-list-sync.yml` remains manual-only. Once official access and usage rights are granted, it can be scheduled without changing the ingestion design.
