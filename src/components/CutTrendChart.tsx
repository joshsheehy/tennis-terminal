// Compact single-series bar chart of a tournament's singles main-draw cut by
// year. Pure server-rendered SVG — no client JS; hover detail comes from
// native <title> tooltips and the per-year tables below the chart act as the
// data-table view.

export type CutTrendPoint = { year: number; cut: number };

const BAR_W = 26;
const GAP = 12;
const PLOT_H = 72;
const LABEL_H = 16; // value labels above bars
const AXIS_H = 16; // year labels below baseline
const PAD_X = 4;

export default function CutTrendChart({ points }: { points: CutTrendPoint[] }) {
  if (points.length < 2) return null;

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
      <p className="cut-trend__label">Singles main-draw cut by year</p>
      <svg
        className="cut-trend__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Singles main-draw cut by year: ${points.map((p) => `${p.year} #${p.cut}`).join(', ')}`}
      >
        {points.map((p, i) => {
          const h = Math.max(4, Math.round((p.cut / maxCut) * PLOT_H));
          const x = PAD_X + i * (BAR_W + GAP);
          const y = baselineY - h;
          const r = 4; // rounded data end, anchored to the baseline
          return (
            <g key={p.year}>
              <title>{`${p.year} · cut #${p.cut}`}</title>
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
        Last direct acceptance into the singles main draw (post-alternates cut where recorded).
        Taller bar = softer cut — a higher rank got in.
      </p>
    </div>
  );
}
