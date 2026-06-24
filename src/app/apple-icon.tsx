import { ImageResponse } from 'next/og';
import { BRAND_INK, logoMarkDataUri } from '@/lib/brand';

// Home-screen icon for iOS / Safari.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND_INK,
        }}
      >
        <img src={logoMarkDataUri({ nodeFill: BRAND_INK })} width={132} height={132} alt="" />
      </div>
    ),
    { ...size },
  );
}
