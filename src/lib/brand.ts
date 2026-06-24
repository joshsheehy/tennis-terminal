// Single source of truth for the Tennis Cuts brand — used by metadata,
// the OG/Twitter image, the favicon/apple-icon, robots and the sitemap.

export const SITE_URL = 'https://tenniscuts.com';
export const SITE_NAME = 'Tennis Cuts';

// The link-preview / meta description. Keep it ~155 chars and keyword-rich.
export const SITE_DESCRIPTION =
  'Track entry cutoffs across the ATP, Challenger and ITF tours, then build your swing around your ranking — live schedules and cut history for the men’s pro tour.';

// Brand green from the TennisCuts logo (the up-trend line + "Cuts" wordmark).
export const BRAND_GREEN = '#3CB043';
// Near-black used for the app-icon / dark surfaces in the mark.
export const BRAND_INK = '#111418';

/**
 * The TennisCuts logo mark as a standalone SVG string: a tennis-court / data
 * "report" frame with a green up-trend line and a small ranking-bar legend.
 *
 * `ink` colours the court frame lines (white on dark surfaces, dark on light).
 * `nodeFill` should match the surface behind the mark so the top chart node
 * reads as an open ring.
 */
export function logoMarkSvg({
  ink = '#FFFFFF',
  nodeFill = BRAND_INK,
  bars = '#8B97A6',
}: { ink?: string; nodeFill?: string; bars?: string } = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
  <rect x="16" y="11" width="30" height="58" rx="5" stroke="${ink}" stroke-width="3"/>
  <line x1="16" y1="40" x2="46" y2="40" stroke="${ink}" stroke-width="2.4"/>
  <line x1="31" y1="25" x2="31" y2="55" stroke="${ink}" stroke-width="2.4"/>
  <line x1="23" y1="25" x2="39" y2="25" stroke="${ink}" stroke-width="1.8"/>
  <line x1="23" y1="55" x2="39" y2="55" stroke="${ink}" stroke-width="1.8"/>
  <polyline points="12,62 26,50 36,53 47,24" stroke="${BRAND_GREEN}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="62" r="4.5" fill="${BRAND_GREEN}"/>
  <circle cx="47" cy="24" r="6" fill="${nodeFill}" stroke="${BRAND_GREEN}" stroke-width="3.5"/>
  <rect x="54" y="20" width="16" height="5" rx="2" fill="${BRAND_GREEN}"/>
  <rect x="54" y="31" width="12" height="4" rx="2" fill="${bars}"/>
  <rect x="54" y="40" width="10" height="4" rx="2" fill="${bars}"/>
  <rect x="54" y="49" width="8" height="4" rx="2" fill="${bars}"/>
</svg>`;
}

/** Same mark encoded as a data URI, for <img src> inside next/og ImageResponse. */
export function logoMarkDataUri(opts?: Parameters<typeof logoMarkSvg>[0]): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(logoMarkSvg(opts))}`;
}
