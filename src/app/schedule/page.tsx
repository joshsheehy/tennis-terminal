import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getEditionsWithCutoffsByIds, getTournamentDetailRowsBySlug, getItfPriorYearCutEditions } from '@/lib/db';
import type { TournamentDetailRow } from '@/lib/db';
import { CutoffSnapshot, ScheduleRow } from '@/lib/types';
import { CURRENT_SEASON, EARLIEST_SEASON } from '@/lib/seasons';
import { detailSheetUrlForEdition, googleFlightsUrl } from '@/lib/tournament-links';

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

function CutText({ value }: { value: number | null }) {
  return value != null ? (
    <span style={{ fontWeight: 600, color: 'var(--text-strong, inherit)' }}>#{value}</span>
  ) : (
    <span style={{ color: 'var(--text-muted)' }}>—</span>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border, #e5e7eb)',
};
const td: React.CSSProperties = {
  padding: '12px',
  fontSize: 14,
  verticalAlign: 'top',
  borderBottom: '1px solid var(--border, #e5e7eb)',
};

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
    <main className="page">
      <a href={backHref} className="back-link">← Back to builder</a>

      <p className="eyebrow">Schedule</p>
      <h1 className="page-title" style={{ marginBottom: 8 }}>Your schedule</h1>
      <p className="page-lede" style={{ marginBottom: 20 }}>
        {stops.length} stop{stops.length === 1 ? '' : 's'}
        {surfaces.length ? ` · ${surfaces.join(' / ')}` : ''}
        {dateRange ? ` · ${dateRange}` : ''}. Cuts are the most recent on record — a
        guide to entry, not a guarantee.
      </p>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, background: 'var(--card, transparent)' }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Dates</th>
              <th style={th}>Tournament</th>
              <th style={th}>Level · Surface</th>
              <th style={{ ...th, textAlign: 'right' }}>Singles MD</th>
              <th style={{ ...th, textAlign: 'right' }}>Singles Q</th>
              <th style={{ ...th, textAlign: 'right' }}>Doubles</th>
              <th style={th}>Detail sheet</th>
              <th style={th}>Travel</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((stop, i) => {
              const e = stop.edition;
              const prev = i > 0 ? stops[i - 1].edition : null;
              const ch = isChallenger(e.level);
              const sm = singlesNum(findCut(stop.refCutoffs, 'singles', 'main'));
              const sq = singlesNum(findCut(stop.refCutoffs, 'singles', 'qualifying'));
              const dd = doublesNum(findCut(stop.refCutoffs, 'doubles', 'main'), ch);
              const flights = prev ? googleFlightsUrl(prev.city, e.city) : null;
              return (
                <tr key={e.edition_id}>
                  <td style={{ ...td, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {fmtRange(e.start_date, e.end_date)}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Week {e.week ?? '—'}</div>
                  </td>
                  <td style={td}>
                    <a href={`/tournaments/${e.slug}`} style={{ fontWeight: 600, color: 'var(--brand-ink, inherit)', textDecoration: 'none' }}>
                      {displayName(e.name)}
                    </a>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {e.city}{e.country ? `, ${e.country}` : ''}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {e.level}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.surface}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}><CutText value={sm} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><CutText value={sq} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><CutText value={dd} /></td>
                  <td style={td}>
                    {stop.detailSheet ? (
                      <a href={stop.detailSheet} target="_blank" rel="noreferrer" className="src-link">
                        Detail sheet ↗
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
                    )}
                    {stop.refYear != null && stop.refYear !== e.year && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>cuts from {stop.refYear}</div>
                    )}
                  </td>
                  <td style={td}>
                    {flights ? (
                      <a href={flights} target="_blank" rel="noreferrer" className="src-link">
                        {prev!.city} → {e.city} ↗
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Start</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        MD = singles main draw cut · Q = singles qualifying cut · Doubles = advance-entry cut.
        Detail sheets and flight links open in a new tab. Cut numbers are the last direct
        acceptance (or post-withdrawal cut where known) from the most recent edition on record.
      </p>
    </main>
  );
}
