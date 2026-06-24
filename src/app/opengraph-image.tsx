import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE_URL, BRAND_GREEN } from '@/lib/brand';

// The image shown when tenniscuts.com is shared (link previews, social cards).
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
          justifyContent: 'space-between',
          padding: 72,
          background: `linear-gradient(125deg, ${BG} 0%, #0f1830 60%, #0d1a12 100%)`,
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Soft green glow in the corner */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: `radial-gradient(closest-side, ${BRAND_GREEN}40, transparent)`,
          }}
        />

        {/* Brand lockup: real logo mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={logoSrc} width={120} height={120} alt="" />
          <div style={{ display: 'flex', marginLeft: 24, fontSize: 64, fontWeight: 800, letterSpacing: -1.5 }}>
            <span style={{ color: '#f8fafc' }}>Tennis</span>
            <span style={{ color: BRAND_GREEN }}>Cuts</span>
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 78, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}>
            <span>Know the cut.</span>
            <span>Build your swing.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, lineHeight: 1.3, color: '#9aa7b8', maxWidth: 860 }}>
            Entry cutoffs, live schedules & a tournament planner for the men’s pro tour.
          </div>
        </div>

        {/* Footer: tour chips + domain */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['ATP Tour', 'Challenger', 'ITF'].map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  padding: '10px 22px',
                  fontSize: 24,
                  color: '#cbd5e1',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 999,
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: BRAND_GREEN }}>{domain}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
