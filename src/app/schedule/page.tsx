import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getEditionsWithCutoffsByIds, getTournamentDetailRowsBySlug, getItfPriorYearCutEditions } from '@/lib/db';
import type { TournamentDetailRow } from '@/lib/db';
import { CutoffSnapshot, ScheduleRow } from '@/lib/types';
import { CURRENT_SEASON, EARLIEST_SEASON } from '@/lib/seasons';
import { detailSheetUrlForEdition, fridayBefore, googleFlightsUrl } from '@/lib/tournament-links';
import ScheduleShareButton from '@/components/ScheduleShareButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your schedule',
  robots: { index: false },
};

// --- cut extraction (compact, mirrors the tournament page's logic) ----------
function findCut(cutoffs: CutoffSnapshot[], event: 'singles' | 'doubles', draw: 'main' | 'qualifying') {
  return cutoffs.find((c) => c.event_type === event && c.draw_type === draw) ?? null;
}
function singlesNum(c: CutoffSnapshot | null): number | null {
  if (!c) return null;
  return c.last_alternate_rank ?? c.last_direct_acceptance_rank ?? null;
}
function doublesNum(c: CutoffSnapshot | null, isChallenger: boolean): number | null {
  if (!c) return null;
  if (isChallenger) return c.challenger_doubles_advanced_cut_rank ?? c.last_alternate_rank ?? c.last_direct_acceptance_rank ?? null;
  return c.last_alternate_rank ?? c.last_direct_acceptance_rank ?? null;
}
function hasAnyCut(cutoffs: CutoffSnapshot[]): boolean {
  return cutoffs.some(
    (c) =>
      c.last_direct_acceptance_rank != null ||
      c.last_alternate_rank != null ||
      c.challenger_doubles_advanced_cut_rank != null
  );
}
function isItf(level: string) {
  return level.toLowerCase().startsWith('itf');
}
function isChallenger(level: string) {
  return level.toLowerCase().includes('challenger');
}
function displayName(name: string) {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}
function fmtRange(start: string | null, end: string | null): string {
  const f = (d: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(d));
  if (!start) return 'TBD';
  return end ? `${f(start)} – ${f(end)}` : f(start);
}

type Stop = {
  edition: ScheduleRow;
  // The edition whose cuts we actually show (this year's if imported, else the
  // most recent prior year with data — labelled so it's clear it's a reference).
  refCutoffs: CutoffSnapshot[];
  refYear: number | null;
  detailSheet: string | null;
};

// Pick the cut data to display for a stop: this edition's own cuts if present,
// otherwise the most recent prior edition of the same tournament that has cuts
// (ATP/Challenger by slug; ITF by tier + city + week).
async function resolveStop(row: TournamentDetailRow): Promise<Stop> {
  const edition = row.edition;
  const detailSheet = detailSheetUrlForEdition(edition);

  if (hasAnyCut(row.cutoffs)) {
    return { edition, refCutoffs: row.cutoffs, refYear: edition.year, detailSheet };
  }

  if (isItf(edition.level)) {
    const itf = await getItfPriorYearCutEditions(edition.level, edition.city, edition.week, edition.year);
    if (itf.length && hasAnyCut(itf[0].cutoffs)) {
      return { edition, refCutoffs: itf[0].cutoffs, refYear: itf[0].edition.year, detailSheet };
    }
    return { edition, refCutoffs: [], refYear: null, detailSheet };
  }

  const history = await getTournamentDetailRowsBySlug(
    edition.slug,
    CURRENT_SEASON - EARLIEST_SEASON + 1,
    edition.year - 1
  );
  const ref = history.find((h) => hasAnyCut(h.cutoffs));
  return ref
    ? { edition, refCutoffs: ref.cutoffs, refYear: ref.edition.year, detailSheet }
    : { edition, refCutoffs: [], refYear: null, detailSheet };
}

function CutChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="sched-cut">
      <div className="sched-cut__label">{label}</div>
      <div className={`sched-cut__val${value == null ? ' sched-cut__val--na' : ''}`}>
        {value == null ? '—' : `#${value}`}
      </div>
    </div>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ build?: string; year?: string }>;
}) {
  const { build, year } = await searchParams;
  const ids = (build ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  // Bare /schedule (no picks) keeps its old behaviour: send people to the calendar.
  if (ids.length === 0) redirect('/cuts');

  const rows = await getEditionsWithCutoffsByIds(ids);
  if (rows.length === 0) redirect('/cuts');

  const stops = await Promise.all(rows.map(resolveStop));

  const backHref = `/?build=${encodeURIComponent(ids.join(','))}${year ? `&year=${encodeURIComponent(year)}` : ''}`;
  const surfaces = Array.from(new Set(stops.map((s) => s.edition.surface))).filter(Boolean);
  const first = stops[0].edition;
  const last = stops[stops.length - 1].edition;
  const dateRange = fmtRange(first.start_date, last.end_date ?? last.start_date);

  return (
    <main className="page page--slim">
      <a href={backHref} className="back-link">← Back to builder</a>

      <div className="sched-head" style={{ margin: '8px 0 8px' }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>Schedule</p>
          <h1 className="page-title" style={{ marginBottom: 6 }}>Your schedule</h1>
        </div>
        <ScheduleShareButton />
      </div>
      <p className="page-lede" style={{ marginBottom: 18 }}>
        {stops.length} stop{stops.length === 1 ? '' : 's'}
        {surfaces.length ? ` · ${surfaces.join(' / ')}` : ''}
        {dateRange ? ` · ${dateRange}` : ''}. Cuts are the most recent on record.
      </p>

      <div className="sched-list">
        {stops.map((stop, i) => {
          const e = stop.edition;
          const prev = i > 0 ? stops[i - 1].edition : null;
          const ch = isChallenger(e.level);
          const sm = singlesNum(findCut(stop.refCutoffs, 'singles', 'main'));
          const sq = singlesNum(findCut(stop.refCutoffs, 'singles', 'qualifying'));
          const dd = doublesNum(findCut(stop.refCutoffs, 'doubles', 'main'), ch);
          const flights = prev ? googleFlightsUrl(prev.city, e.city, fridayBefore(e.start_date)) : null;
          return (
            <div key={e.edition_id} className="sched-card">
              <div className="sched-card__top">
                <div className="sched-card__title">
                  <span className="sched-card__num">{i + 1}</span>
                  <a href={`/tournaments/${e.slug}`} className="sched-card__name">
                    {displayName(e.name)}
                  </a>
                </div>
                <div className="sched-card__dates">
                  {fmtRange(e.start_date, e.end_date)}
                  <div>Week {e.week ?? '—'}</div>
                </div>
              </div>
              <p className="sched-card__meta">
                {e.city}{e.country ? `, ${e.country}` : ''} · {e.level} · {e.surface}
              </p>

              <div className="sched-cuts">
                <CutChip label="Singles MD" value={sm} />
                <CutChip label="Singles Q" value={sq} />
                <CutChip label="Doubles" value={dd} />
              </div>

              <div className="sched-actions">
                {flights && (
                  <a href={flights} target="_blank" rel="noreferrer" className="sched-btn" title={`Flights ${prev!.city} → ${e.city}`}>
                    ✈︎ Flights
                  </a>
                )}
                {stop.detailSheet ? (
                  <a href={stop.detailSheet} target="_blank" rel="noreferrer" className="sched-btn">
                    📄 Detail sheet
                  </a>
                ) : (
                  <span className="sched-btn sched-btn--ghost" aria-disabled="true">📄 No sheet</span>
                )}
                {stop.refYear != null && stop.refYear !== e.year && (
                  <span className="sched-ref">cuts from {stop.refYear}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.5 }}>
        MD = singles main draw · Q = singles qualifying · Doubles = advance entry. Cut numbers are
        the last direct acceptance (or post-withdrawal cut where known) from the most recent
        edition on record.
      </p>
    </main>
  );
}
