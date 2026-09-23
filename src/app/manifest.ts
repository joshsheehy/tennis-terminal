import type { MetadataRoute } from 'next';
import { SITE_NAME } from '@/lib/brand';

// Next.js serves this at /manifest.webmanifest and links it automatically —
// no manual <link rel="manifest"> needed in layout.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Entry Cutoffs & Schedule`,
    short_name: SITE_NAME,
    description:
      'Entry cutoffs, schedules and swing planning for the ATP, Challenger and ITF tours.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
