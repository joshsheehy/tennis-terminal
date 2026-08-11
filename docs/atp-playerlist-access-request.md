# ATP / ProTennisLive PlayerList access request

Prepared for TennisCuts. Do not send automatically; review before contacting ATP/TDI.

## Subject

Read-only ProTennisLive PlayerList access for player tournament-planning tool

## Request

Hello,

I am building TennisCuts, a non-betting tournament-planning utility for professional tennis players. The product helps players compare ATP Tour and Challenger entry situations across tournaments in the same week without repeatedly opening separate acceptance lists.

We have reviewed the public ProTennisLive Swagger documentation and the `orgclient` contract appears to contain the exact structured source we need:

`GET /PlayerList/{tournamentYear}/{tournamentId}`

We would like to request legitimate read-only access to that endpoint for ATP Tour and ATP Challenger events, along with permission to cache low-frequency revision snapshots and display player entry status / alternate movement in TennisCuts.

Our intended usage is deliberately small and cache-first:

- only upcoming tournaments
- normally no more than four checks per day per event
- use ATP tournament year + numeric tournament ID as the key
- normalize/hash the returned list
- write a new snapshot only when the list changes
- no live-score scraping, betting use, or PlayerZone session automation

The PlayerList fields we expect to use are:

- `MainQualyDrawType`
- `IsDoubles`
- `PlayerListType`
- published `PlayerList` order
- `PlayerId`
- player name and nationality
- `RankRoll`
- `EntryCode`
- `Alternate`
- `PartnerId` for doubles

We would also appreciate clarification on three fields that appear on the official Player Acceptance List reports but are not present in the documented orgclient PlayerList schema:

1. literal `Original Cut Off`
2. the acceptance-list `Ranking Date`
3. the report/list publication date

Is there an authorized ECEAS/acceptance-report endpoint, additional contract, or metadata field that exposes those values?

For a small technical pilot, the ATP Challenger events beginning the week of 17 August 2026 are sufficient. The tournament IDs we currently have are:

- Kingston 1 — 3121
- Prague — 600
- Roehampton 1 — 3123
- Sion — 3133
- Cancun — 3009
- Quebec City — 3103

Could you advise on:

- whether `orgclient` PlayerList access is available for this use case
- the appropriate token scope / authorization method
- token expiry and renewal
- applicable rate limits
- whether ATP or Tennis Data Innovations is the correct entity for storage/display licensing
- permission to retain historical snapshots of list movement
- whether the complete alternate order returned by PlayerList may be displayed to authenticated or public TennisCuts users

If the Tennis Data Platform sandbox is the preferred route for a third-party product like this, I would be happy to use that instead.

Thank you.

## Technical notes for follow-up

Current implementation is already gated behind `PROTENNISLIVE_TOKEN` and remains disabled without an explicitly supplied token. It calls only the documented orgclient PlayerList endpoint. No logged-in PlayerZone credentials, cookies, or session automation are used.

The importer preserves ATP-published order and derives ALT position from the sequence of rows where `Alternate=true`; it does not sort alternates by ranking or infer `Original Cut Off`.
