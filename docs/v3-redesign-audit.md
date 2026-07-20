# V3 redesign — the ruthless audit and what this branch does about it

Written as if reviewing a stranger's product. Screens audited: home/builder,
cuts calendar, tournament page, alerts, on desktop (1280px) and mobile (390px).

## The verdict

The data is a must-have. The product around it is not — yet. Five seasons of
real cuts plus honest projections is something no player has anywhere else,
but the app leads with a form instead of that story, hides its best numbers
behind accordions, and speaks in database language ("Not yet imported") to
people who just want to know if they'd get in. Nothing here is beyond a
focused pass; the bones are genuinely good.

## What's wrong (most damaging first)

1. **There is no front door.** `/` opened a modal on top of an empty map and
   asked for the visitor's ranking before showing a single cut. No pitch, no
   proof, no reason to care. A player who lands cold has to guess what the
   site even is.
2. **The killer feature is buried.** "Would I get in?" is the entire product,
   and the ranking inputs existed only inside the builder's one-time welcome
   card. Everywhere else — cuts calendar, tournament pages — the viewer's
   ranking is unknown and every number stays abstract.
3. **The cuts calendar shows no cuts.** Rows on `/cuts` carry name, city and
   badges but not one cut number; each requires opening a week, then a
   tournament page. The page is titled "Tournament calendar" under a nav item
   named "Cuts", and apologizes with instructional copy ("Pick a week
   first…") for a flow that should be self-evident.
4. **Database language leaks everywhere.** "Not yet imported", "Not on
   record", "Viewing year", "source" — a player doesn't import things; either
   the cut is known, pending, or the event hasn't happened.
5. **The tournament page buries its answer.** A header card repeats the same
   level/week/date three times before the first cut appears; the projection
   (the reason to visit before entering) reads as one row among many.
6. **Visual identity is default.** Gray-on-white cards, a single green, no
   typographic point of view. The alert emails got a branded header before
   the site did.

## What this branch ships

- **A real landing page at `/`** — value proposition, live coverage stats
  from the database, three feature cards, three-step "how it works", CTAs
  into the builder/cuts/alerts. The builder moved to `/builder` (still one
  click from everywhere; `/swings` untouched).
- **"My rank" in the nav, verdicts everywhere it can reach.** One chip, tap,
  enter singles/doubles rank (device-only, same storage the builder already
  used — no migration). Every tournament-page cut now renders a pill:
  **"You're in by 74" / "On the bubble" / "Out by 112"**, singles and doubles
  judged against their own rank. The builder's welcome inputs and the nav
  chip stay in sync.
- **Cuts page renamed to what it is** ("Every cut, week by week") with the
  apology copy replaced.

## What V3 should do next (in impact order)

1. **Cut numbers + verdict dots on the calendar rows themselves** — needs the
   schedule query to join the latest cut per edition; then `/cuts` becomes a
   scannable answer sheet instead of an accordion of doors.
2. **Player-language empty states** ("Cuts land after the entry deadline —
   this event's closes March 2") replacing importer vocabulary.
3. **Tournament page hierarchy**: verdict + this-year projection as the hero
   block, history and chart below, single metadata line.
4. **A projection accuracy page** — publish the tracking report (median error
   by tier, band coverage). "We show our misses" is the credibility move
   competitors won't make.
5. **Season heat-strip view**: one row per week, colored by the viewer's
   verdict at their rank — the "where can I actually play this fall" glance.
