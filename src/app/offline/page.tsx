import type { Metadata } from 'next';

// Shown by the service worker when a navigation fails offline and nothing
// cached matches — the fallback in PRECACHE_URLS (public/sw.js), so it must
// stay a static route with no server-side data dependency.
export const metadata: Metadata = {
  title: 'You’re offline',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        gap: '0.5rem',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', color: 'var(--text-strong)' }}>You’re offline</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: '28rem' }}>
        This page needs a connection to load fresh data. Reconnect and reload — pages you’ve
        already visited will still open from cache.
      </p>
    </main>
  );
}
