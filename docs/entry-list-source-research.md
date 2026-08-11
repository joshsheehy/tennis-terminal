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

Direct unauthenticated requests return HTTP 401. Swagger declares Bearer/JWT authorization. We must not bypass that requirement or automate a logged-in PlayerZone session.

ATP's Tournament Data Form publicly states that tournament developers can use the ProTennisLive Swagger and that development teams requiring tokens should contact Bram Tukker at ATP. That establishes a legitimate token-request path.

## PlayerList metadata gap

The documented PlayerList schema does **not** expose these acceptance-report header fields:

- literal `Original Cut Off`
- acceptance-list `Ranking Date`
- report/list publication date

Do not synthesize those fields from PlayerList contents. Ask ATP/TDI whether an acceptance-report/ECEAS-equivalent endpoint or additional contract exposes them.

## PlayerZone report routes

The modern report hostname `ps-site.atppz.com` currently resolves in public DNS to `10.80.3.20`, an RFC1918 private address. It is therefore not a generally reachable public web source from GitHub Actions or Railway. Do not keep treating timeouts from this host as a URL-guessing problem.

The older ECEAS report family generated the exact PDF style TennisCuts wants (Official Player Acceptance List, Original Cut Off, Ranking Date, numbered Alternates), but current unauthenticated access to the legacy PlayerZone report service is authorization-gated.

Do not automate PlayerZone credentials, cookies, sessions or authentication workarounds.

## ATP public website

ATP's public tournament frontend has a `whoisplaying` roster feature, but the observed model is promotional: player/profile/country information rather than full acceptance-list rank, EntryCode and alternate-queue data. It is not a replacement for PlayerList.

## Official access paths to pursue

1. **ATP ProTennisLive token** — request read-only access appropriate for TennisCuts, preferably the `orgclient /PlayerList/{year}/{tournamentId}` contract so existing tournament codes remain the key.
2. **Tennis Data Innovations (TDI)** — TDI centrally manages/commercializes ATP data and advertises a Tennis Data Platform sandbox for third-party innovation. Ask whether acceptance lists are included and what storage/display rights apply.
3. **Champion Data TDI Service Desk** — Champion Data operates the TDI platform and exposes a TDI partner service desk. This is a secondary formal route for platform/API access questions.

The access request should explicitly describe TennisCuts as a non-betting player tournament-planning utility with low-volume, cached, read-only usage and request the following fields/rights:

- tournament year/id
- main vs qualifying
- singles vs doubles
- PlayerListType
- stable published player order
- PlayerId/name/nationality/rank
- EntryCode
- Alternate
- Original Cut Off
- Ranking Date
- list/report date
- permission to cache snapshots and display current position/movement to players

## Code already prepared

`src/lib/protennis-player-list.ts` is an official PlayerList adapter that only works when a legitimately issued bearer token is explicitly supplied. It contains no PlayerZone credential/session automation or bypass logic.

`src/lib/protennis-player-list.test.ts` verifies that published order is preserved, alternate positions are derived from that order, and cutoff/ranking-date metadata is not invented.

Automatic entry-list sync remains paused until a direct official source is authorized and validated.
