// Per-event week competition, in the shape the swing builder's info popover
// needs: how many acceptance places sit within reach at this event's level or
// better, and where the event ranks among the ones it competes with that week.
//
// This replaces the beta cut projection in that popover. The projection
// answered "what number will the cut be", which the model does poorly — its own
// backtest beat the "same cut as last year" baseline by only 14-20% MAE, and a
// point estimate reads as far more certain than that. Week competition answers
// "how does this event compare with the alternatives that week", which is the
// claim the depth validation actually supports (V1: 73-75% of within-week pairs
// ordered correctly) and the question a player picking between events is asking.

import type { Pool } from 'pg';
import { haversineKm } from './cut-prediction';
import { computeDepth, sameWeekScope, type DepthEvent, type Discipline } from './depth';
import { loadDepthEvents } from './depth-data';
import { REGION_KM } from './depth-week';

export type WeekCompetition = {
  /** Acceptance places within reach at this level or better, own draw included. */
  places: number;
  /** 1 = easiest to enter of the events it competes with. */
  rank: number;
  /** How many events it was ranked against, including itself. */
  of: number;
  /** Whether `places` came from a real imported draw size or a level default. */
  estimated: boolean;
};

export type WeekCompetitionByDraw = {
  m?: WeekCompetition;
  d?: WeekCompetition;
};

/** Events within REGION_KM of `target` in the same week — the ones it is
 * genuinely competing with for entries. */
function neighbours(target: DepthEvent, weekEvents: DepthEvent[]): DepthEvent[] {
  if (target.latitude == null || target.longitude == null) return [target];
  return weekEvents.filter(
    (e) =>
      e.latitude != null &&
      e.longitude != null &&
      haversineKm(target.latitude!, target.longitude!, e.latitude, e.longitude) <= REGION_KM
  );
}

/**
 * Week competition for every event in `year`, keyed by tournament slug.
 *
 * Ranks are computed against the event's own neighbourhood rather than a
 * pre-partitioned cluster, so each event is compared with exactly the events
 * within reach of IT. Two events can therefore both rank 1st in overlapping
 * neighbourhoods, which is correct: they each have a different set of
 * alternatives.
 */
export async function loadWeekCompetition(
  pool: Pool,
  year: number
): Promise<Record<string, WeekCompetitionByDraw>> {
  const events = await loadDepthEvents(pool);
  const inYear = events.filter((e) => e.year === year);

  const byWeek = new Map<number, DepthEvent[]>();
  for (const e of inYear) {
    if (!byWeek.has(e.week)) byWeek.set(e.week, []);
    byWeek.get(e.week)!.push(e);
  }

  const out: Record<string, WeekCompetitionByDraw> = {};

  for (const [week, weekEvents] of byWeek) {
    const scope = sameWeekScope(events, year, week);

    for (const discipline of ['singles', 'doubles'] as Discipline[]) {
      const key = discipline === 'singles' ? 'm' : 'd';
      // Depth for every event in the week once, then rank inside neighbourhoods.
      const depths = new Map<string, ReturnType<typeof computeDepth>>();
      for (const e of weekEvents) depths.set(e.editionId, computeDepth(e, scope, discipline));

      for (const e of weekEvents) {
        const own = depths.get(e.editionId)!;
        const group = neighbours(e, weekEvents);
        // More places within reach means a thinner field, so easiest first.
        const better = group.filter(
          (g) => (depths.get(g.editionId)?.depth ?? 0) > own.depth
        ).length;

        (out[e.slug] ??= {})[key] = {
          places: Math.round(own.depth),
          rank: better + 1,
          of: group.length,
          estimated: own.slotsSource === 'default',
        };
      }
    }
  }

  return out;
}
