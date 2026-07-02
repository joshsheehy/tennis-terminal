import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE_URL, BRAND_GREEN } from '@/lib/brand';

// The image shown when tenniscuts.com is shared (link previews, social cards).
// Kept deliberately minimal: logo lockup, one description line, the domain.
export const alt = 'Tennis Cuts — entry cutoffs, schedules & swing planner for the pro tennis tour';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#0b1220';

export default async function OpengraphImage() {
  const domain = SITE_URL.replace(/^https?:\/\//, '');
  const logo = await readFile(join(process.cwd(), 'public', 'logo-mark.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(125deg, ${BG} 0%, #0f1830 60%, #0d1a12 100%)`,
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Brand lockup: real logo mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={logoSrc} width={148} height={148} alt="" />
          <div style={{ display: 'flex', marginLeft: 30, fontSize: 96, fontWeight: 800, letterSpacing: -2.5 }}>
            <span style={{ color: '#f8fafc' }}>Tennis</span>
            {/* Negative margin closes the inter-span gap so it reads "TennisCuts" like the nav */}
            <span style={{ color: BRAND_GREEN, marginLeft: -4 }}>Cuts</span>
          </div>
        </div>

        {/* One-line pitch under the lockup */}
        <div
          style={{
            display: 'flex',
            marginTop: 46,
            fontSize: 29,
            lineHeight: 1.4,
            color: '#9aa7b8',
            textAlign: 'center',
            justifyContent: 'center',
          }}
        >
          Entry cutoffs, live schedules &amp; a tournament planner for the men&rsquo;s pro tour.
        </div>

        {/* Domain, pinned bottom center */}
        <div
          style={{
            position: 'absolute',
            bottom: 52,
            display: 'flex',
            fontSize: 27,
            fontWeight: 600,
            color: BRAND_GREEN,
            letterSpacing: 0.5,
          }}
        >
          {domain}
        </div>
      </div>
    ),
    { ...size },
  );
}
