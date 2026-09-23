'use client';

import { useEffect } from 'react';

// Registers public/sw.js. Skipped outside production so `next dev`'s hot
// reload never fights a stale cached response.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('service worker registration failed', err);
    });
  }, []);

  return null;
}
