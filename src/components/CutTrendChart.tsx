'use client';

// The "cut line": a compact line chart of a tournament's entry cut by year,
// echoing the TennisCuts logo mark (green line with dot markers). A draw
// picker switches singles main / singles qualifying / doubles. Pure SVG — the
// only client behavior is the tab state; hover detail comes from native
// <title> tooltips and each dot deep-links to that year's full card below
// (cut table, alternates / lucky losers, draw PDFs).

import { useState } from 'react';

export type CutTrendPoint = {
  year: number;
  cut: number;
  /** Alternates who got in and lucky losers, shown in the tooltip. */
  alt?: number;
  ll?: number;
};

export type CutTrendSeries = {
  key: 'singles_main' | 'singles_qualifying' | 'doubles_main';
  label: string;
  points: CutTrendPoint[];
};

const DRAW_PHRASE: Record<CutTrendSeries['key'], string> = {
  singles_main: 'singles main draw',
  singles_qualifying: 'singles qualifying draw',
  doubles_main: 'doubles main draw',
};

const PAD_X = 18;
const PLOT_H = 76;
const LABEL_H = 18; // room for value labels above the highest dot
const AXIS_H = 16; // year labels below baseline

export default function CutTrendChart({ series }: { series: CutTrendSeries[] }) {
  // Only draws with enough history to show a trend get a tab.
  const available = series.filter((s) => s.points.length >= 2);
  const [activeKey, setActiveKey] = useState(available[0]?.key);
  if (available.length === 0) return null;
  const current = available.find((s) => s.key === activeKey) ?? available[0];
  const points = current.points;
  const n = points.length;
  // Wider spacing when the series is short so a 2–4 year line still has
  // presence; tighter once a real history accumulates.
  const STEP_X = n <= 4 ? 72 : 52;

  const maxCut = Math.max(...points.map((p) => p.cut));
  const minCut = Math.min(...points.map((p) => p.cut));
  // Zoomed (non-zero) domain so year-to-year movement is actually visible —
  // cut ranks live in the hundreds, where zero-based bars flatten everything.
  const pad = Math.max((maxCut - minCut) * 0.35, maxCut * 0.06, 8);
  const lo = minCut - pad;
  const hi = maxCut + pad;

  const width = PAD_X * 2 + (n - 1) * STEP_X;
  const height = LABEL_H + PLOT_H + AXIS_H;
  const baselineY = LABEL_H + PLOT_H;
  const xAt = (i: number) => PAD_X + i * STEP_X;
  const yAt = (cut: number) => LABEL_H + (1 - (cut - lo) / (hi - lo)) * PLOT_H;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.cut).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xAt(n - 1)},${baselineY} L${xAt(0)},${baselineY} Z`;

  // Every dot carries its cut number. Labels sit above the dot, except at a
  // local minimum where the line would run through the text — those go below.
  const labelBelow = (i: number) => {
    const prev = points[i - 1]?.cut ?? Infinity;
    const next = points[i + 1]?.cut ?? Infinity;
    return points[i].cut <= prev && points[i].cut <= next;
  };

  return (
    <div className="cut-trend">
      <p className="cut-trend__label">Entry cut by year</p>
      {available.length > 1 && (
        <div className="cut-trend__tabs" role="tablist" aria-label="Draw">
          {available.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={s.key === current.key}
              className={`cut-trend__tab${s.key === current.key ? ' cut-trend__tab--on' : ''}`}
              onClick={() => setActiveKey(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <svg
        className="cut-trend__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${current.label} cut by year: ${points.map((p) => `${p.year} #${p.cut}`).join(', ')}`}
      >
        <line
          x1={0}
          y1={baselineY + 0.5}
          x2={width}
          y2={baselineY + 0.5}
          className="cut-trend__baseline"
        />
        <path d={areaPath} className="cut-trend__area" />
        <path
          d={linePath}
          className="cut-trend__line"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => {
          const x = xAt(i);
          const y = yAt(p.cut);
          const altLl =
            p.alt != null || p.ll != null ? ` · ${p.alt ?? 0} ALT / ${p.ll ?? 0} LL` : '';
          return (
            // Each dot deep-links to that year's full card below the chart
            // (cut table, alternates/lucky losers, draw PDF links).
            <a key={p.year} href={`#y-${p.year}`} aria-label={`Jump to ${p.year} details`}>
              <g className="cut-trend__pt">
                <title>{`${p.year} · ${current.label} cut #${p.cut}${altLl} — tap for the full table & draw links`}</title>
                {/* Invisible full-height hit target so the dot is easy to tap */}
                <rect
                  x={x - STEP_X / 2}
                  y={0}
                  width={STEP_X}
                  height={height}
                  fill="transparent"
                />
                <circle cx={x} cy={y} r={4.5} strokeWidth={2} className="cut-trend__dot" />
                <text
                  x={x}
                  y={labelBelow(i) ? y + 17 : y - 9}
                  textAnchor="middle"
                  className="cut-trend__value"
                >
                  {p.cut}
                </text>
                <text x={x} y={baselineY + 12} textAnchor="middle" className="cut-trend__year">
                  {String(p.year).slice(2)}
                </text>
              </g>
            </a>
          );
        })}
      </svg>
      <p className="cut-trend__note">
        Last direct acceptance into the {DRAW_PHRASE[current.key]}
        {current.key === 'singles_main' ? ' (post-alternates cut where recorded)' : ''}. Higher
        on the line = softer cut — a higher rank got in. Tap a dot to jump to that
        year&rsquo;s full table — alternates, lucky losers, and draw links included.
      </p>
    </div>
  );
}
