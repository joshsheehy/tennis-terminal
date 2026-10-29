import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { parseEditionIds } from '@/lib/auth-core';
import { BRAND_GREEN, SITE_URL } from '@/lib/brand';
import { getEditionsWithCutoffsByIds } from '@/lib/db';
import { dateSpan, shortDate, toShareStops } from '@/lib/schedule-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): the link-preview image
// for a shared /schedule?build=… — the TennisCuts lockup, the swing's dates,
// and its stops, so whoever receives the link sees what it is and where it
// came from. GET ?build=<edition ids>.
const BG = '#151412';
const MUTED = '#a19b91';
const MAX_ROWS = 5;

export async function GET(request: NextRequest) {
  const ids = parseEditionIds(request.nextUrl.searchParams.get('build') ?? '');
  const stops = ids.length ? toShareStops((await getEditionsWithCutoffsByIds(ids)).map((r) => r.edition)) : [];
  const logo = await readFile(join(process.cwd(), 'public', 'logo-mark-v2.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const span = first?.start && (last?.end ?? last?.start) ? dateSpan(first.start, (last.end ?? last.start)!) : '';
  const shown = stops.slice(0, MAX_ROWS);
  const more = stops.length - shown.length;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, color: '#f7f5f1', fontFamily: 'sans-serif', padding: '56px 72px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={logoSrc} width={64} height={64} alt="" />
          <div style={{ display: 'flex', marginLeft: 18, fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>
            <span>Tennis</span>
            <span style={{ color: BRAND_GREEN, marginLeft: -2 }}>Cuts</span>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 52, fontWeight: 800, letterSpacing: -1 }}>
          {stops.length ? `${stops.length}-stop tennis schedule` : 'A tennis schedule'}
        </div>
        {span && <div style={{ display: 'flex', marginTop: 6, fontSize: 30, color: MUTED }}>{span}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
          {shown.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 14, fontSize: 30 }}>
              <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 23, background: BRAND_GREEN, color: '#fff', fontSize: 24, fontWeight: 800, alignItems: 'center', justifyContent: 'center' }}>
                {i + 1}
              </div>
              <div style={{ display: 'flex', marginLeft: 20, fontWeight: 700 }}>{s.name}</div>
              <div style={{ display: 'flex', marginLeft: 16, color: MUTED }}>
                {s.level}
                {s.start ? ` · ${shortDate(s.start)}` : ''}
              </div>
            </div>
          ))}
          {more > 0 && <div style={{ display: 'flex', fontSize: 26, color: MUTED, marginLeft: 66 }}>+ {more} more</div>}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', fontSize: 26, fontWeight: 600, color: BRAND_GREEN }}>
          Planned on {SITE_URL.replace(/^https?:\/\//, '')}
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=3600' } }
  );
}
