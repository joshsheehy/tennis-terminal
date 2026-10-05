# Primary sources

External documents this project's rules are checked against, kept here so a
claim like "the Rulebook says X" can be verified without re-downloading
anything — atptour.com returns 403 to this project's own runners (see
`src/lib/ptl-code-overrides.ts`'s header for the same problem elsewhere), so
"just fetch it again" isn't always an option.

## `atp-rulebook-2026-*.pdf`

The 2026 ATP Official Rulebook, downloaded 2026-10-05 from
atptour.com/corporate/rulebook. Chapters are published separately; only the
ones actually cited somewhere in this codebase are kept here.

- `atp-rulebook-2026-toc.pdf` — table of contents, for finding the right
  chapter.
- `atp-rulebook-2026-ch1-circuit-regulations.pdf` — §1.02 "Tournament Week":
  ATP's reserved right to run a different schedule for Challengers around a
  Grand Slam or ATP Masters 1000.
- `atp-rulebook-2026-ch7-the-competition.pdf` — §7.03 "Entry Deadlines": the
  standard day-counts `src/lib/entry-deadlines.ts` implements, and §7.03 D's
  general "ATP may extend the deadline... when unforeseen circumstances
  arise."

Entry-deadline exceptions to those standard day-counts — confirmed from real
tournaments' own detail sheets, not derivable from the Rulebook text alone —
live in `src/lib/entry-deadline-overrides.ts`, whose header explains why and
how to add more as they're found.
