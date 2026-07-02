'use client';

// Compact single-series bar chart of a tournament's entry cut by year, with a
// draw picker (singles main / singles qualifying / doubles). Pure SVG — the
// only client behavior is the tab state; hover detail comes from native
// <title> tooltips and each bar deep-links to that year's full card below
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

const BAR_W = 26;
const GAP = 12;
const PLOT_H = 72;
const LABEL_H = 16; // value labels above bars
const AXIS_H = 16; // year labels below baseline
const PAD_X = 4;

export default function CutTrendChart({ series }: { series: CutTrendSeries[] }) {
  // Only draws with enough history to show a trend get a tab.
  const available = series.filter((s) => s.points.length >= 2);
  const [activeKey, setActiveKey] = useState(available[0]?.key);
  if (available.length === 0) return null;
  const current = available.find((s) => s.key === activeKey) ?? available[0];
  const points = current.points;

  const maxCut = Math.max(...points.map((p) => p.cut));
  const minCut = Math.min(...points.map((p) => p.cut));
  const latestYear = points[points.length - 1].year;
  // Selective direct labels: min, max, and the latest year only.
  const labeled = new Set<number>();
  for (const p of points) {
    if (p.cut === maxCut || p.cut === minCut || p.year === latestYear) labeled.add(p.year);
  }

  const width = PAD_X * 2 + points.length * BAR_W + (points.length - 1) * GAP;
  const height = LABEL_H + PLOT_H + AXIS_H;
  const baselineY = LABEL_H + PLOT_H;

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
        {points.map((p, i) => {
          const h = Math.max(4, Math.round((p.cut / maxCut) * PLOT_H));
          const x = PAD_X + i * (BAR_W + GAP);
          const y = baselineY - h;
          const r = 4; // rounded data end, anchored to the baseline
          const altLl =
            p.alt != null || p.ll != null ? ` · ${p.alt ?? 0} ALT / ${p.ll ?? 0} LL` : '';
          return (
            // Each bar deep-links to that year's full card below the chart
            // (cut table, alternates/lucky losers, draw PDF links).
            <a key={p.year} href={`#y-${p.year}`} aria-label={`Jump to ${p.year} details`}>
              <g className="cut-trend__bar-group">
                <title>{`${p.year} · ${current.label} cut #${p.cut}${altLl} — tap for the full table & draw links`}</title>
                {/* Invisible full-height hit target so short bars stay tappable */}
                <rect
                  x={x - GAP / 2}
                  y={0}
                  width={BAR_W + GAP}
                  height={height}
                  fill="transparent"
                />
                <path
                  d={`M${x},${baselineY} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + BAR_W - r},${y} Q${x + BAR_W},${y} ${x + BAR_W},${y + r} L${x + BAR_W},${baselineY} Z`}
                  className="cut-trend__bar"
                />
                {labeled.has(p.year) && (
                  <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" className="cut-trend__value">
                    {p.cut}
                  </text>
                )}
                <text
                  x={x + BAR_W / 2}
                  y={baselineY + 12}
                  textAnchor="middle"
                  className="cut-trend__year"
                >
                  {String(p.year).slice(2)}
                </text>
              </g>
            </a>
          );
        })}
        <line
          x1={0}
          y1={baselineY + 0.5}
          x2={width}
          y2={baselineY + 0.5}
          className="cut-trend__baseline"
        />
      </svg>
      <p className="cut-trend__note">
        Last direct acceptance into the {DRAW_PHRASE[current.key]}
        {current.key === 'singles_main' ? ' (post-alternates cut where recorded)' : ''}. Taller
        bar = softer cut — a higher rank got in. Tap a bar to jump to that year&rsquo;s full
        table — alternates, lucky losers, and draw links included.
      </p>
    </div>
  );
}
