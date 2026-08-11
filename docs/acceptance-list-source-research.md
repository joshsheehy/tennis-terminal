# ATP acceptance-list source research

Last updated: 2026-08-11

## Product requirement

TennisCuts needs the complete ordered acceptance list, not only the cutoff: direct acceptances, full alternate queue, ranks, countries, entry/status codes, qualifying, and doubles. Preserve literal `Original Cut Off` when an official report provides it; never infer the original cutoff from the lowest-ranked main-draw player.

## Best official structured source found

ATP's official ProTennisLive OpenAPI documents:

`GET https://api.protennislive.com/feeds/PlayerList/{tournamentYear}/{tournamentId}`

The documented response is almost exactly the TennisCuts data model:

- main vs qualifying (`MainQualyDrawType`)
- singles vs doubles (`IsDoubles`)
- original acceptance list vs draw (`PlayerListType`)
- ATP player ID, first/last name and nationality
- rolling rank (`RankRoll`)
- entry/status code (`EntryCode`)
- alternate flag (`Alternate`)
- partner ID for doubles

The API uses the normal ATP tournament year + numeric tournament ID, which is ideal for autonomous code-driven syncing.

### Access test

Unauthenticated requests currently return HTTP 401 with `WWW-Authenticate: Bearer`. The public OpenAPI applies bearer security globally. We also tested calendar, tournament, participants, draws, results, schedules, rankings, players and live-match routes; they are bearer-protected too. No public token/login/OAuth issuance endpoint is documented in the OpenAPI.

Conclusion: this is the preferred source if ATP/TDI grants legitimate API access, but it must not be bypassed or fed scraped/leaked credentials.

## ProTennisLive static posting host

A full 1-3 letter filename sweep was performed separately against a live tournament code (18,278 candidates). The useful static posting files are draw/detail artifacts, not acceptance lists:

- `mds.pdf` — singles main draw once published; before publication can be an unavailable stub
- `mdd.pdf` — doubles main draw
- `qs.pdf` — singles qualifying draw
- `qd.pdf` — qualifying doubles where applicable
- `ds.pdf` — detail/fact sheet
- `x.pdf` — small image/placeholder artifact

No hidden short PDF filename produced the acceptance list. Do not repeat this brute-force sweep.

## PlayerZone report routes

Historical ATP ECEAS reports and modern organizer links prove ATP centrally generates the desired "Official Player Acceptance List" report, including `Original Cut Off` and a numbered alternates section.

Known historical/current-looking route families include:

- `ps.atppz.com/eceas/ECEAS-Report-Data.asp?TournamentID=YEAR-CODE`
- `icontent.atptour.com/AcceptanceList/...`
- `ps-site.atppz.com/Singles/AcceptanceList/YEAR/CODE/P`

Current findings:

- legacy ECEAS route returns 401
- modern `ps-site.atppz.com` route timed out from both GitHub-hosted and Railway-hosted probes
- guessed equivalents on `www.atppz.com` return 404
- `www.atppz.com/robots.txt` currently disallows all crawling
- public PlayerZone login JavaScript confirms UI concepts for singles, qualifying, Challenger and doubles entry information, but exposes no usable public acceptance-list API route

Conclusion: do not automate authenticated PlayerZone or build a crawler against `www.atppz.com`.

## ATP public website

ATP tournament overview pages are public and expose tournament IDs/calendar information, but no public full acceptance/alternate-list route has been found. ATP occasionally publishes editorial entry-list articles; these do not provide the complete alternate queue required by TennisCuts.

## Tennis Data Innovations (TDI)

TDI is ATP/ATP Media's official data joint venture. Its Tennis Data Platform publicly says it includes an open sandbox for third-party innovation. TDI/Champion Data also operate an official service desk with general platform/API inquiries and API-key/token support categories.

The public `results.tennisdata.com` site was inspected:

- official and publicly accessible
- Next.js/tRPC application with a same-origin `/api/trpc` data layer
- server-rendered tournament/result/player filtering data
- a direct future-date probe for 2026-08-17/18 did not surface the six upcoming Challenger events as a useful pre-event participant/acceptance-list feed

Conclusion: the Results portal appears match/results oriented, not a replacement for pre-draw acceptance lists. The broader TDI sandbox/API is the strongest legitimate access path to investigate next, specifically asking whether the ATP `PlayerList`/acceptance-list dataset is available.

## Aug. 17, 2026 experiment week

Target ATP Challenger tournament IDs:

- Kingston 1 — 3121
- Prague — 600
- Roehampton 1 — 3123
- Sion — 3133
- Cancun — 3009
- Quebec City — 3103

These should be the first six events used to validate any official ATP/TDI source.

## Production rule

The recurring entry-list workflow remains disabled/manual-only until a direct ATP, TDI, or verifiably public PlayerZone source is validated. Third-party aggregators may be used for research/cross-checking but not as the production hub.

Once legitimate structured access exists, the cheapest production loop is:

1. derive year + ATP tournament code from the existing schedule
2. request the official player list
3. normalize only the fields TennisCuts needs
4. hash the normalized list
5. write one compact JSON snapshot only when the hash changes
6. derive DA/ALT position and movement at read time

This avoids PDF parsing entirely when the structured PlayerList API is available.
