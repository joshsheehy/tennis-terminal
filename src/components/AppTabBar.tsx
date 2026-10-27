'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_LINKS, NavKey, isNavActive } from '@/lib/nav';

// Bottom tab bar for the iOS app. Rendered on every page but hidden by CSS
// unless <html> carries .in-app (set before first paint by the head script in
// layout.tsx), so the website never shows it and the app never flickers.

const ICONS: Record<NavKey, React.ReactNode> = {
  // Route between two pins: building a run of tournaments.
  builder: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
    </>
  ),
  // Ranked list: the cut lines.
  cuts: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  alerts: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
      <path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  saved: <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />,
};

export default function AppTabBar() {
  const pathname = usePathname();
  return (
    <nav className="app-tabbar" aria-label="Sections">
      {NAV_LINKS.map((l) => {
        const on = isNavActive(l.href, pathname);
        return (
          <Link
            key={l.key}
            href={l.href}
            aria-current={on ? 'page' : undefined}
            className={`app-tabbar__tab${on ? ' app-tabbar__tab--on' : ''}`}
          >
            <svg
              className="app-tabbar__icon"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill={on && l.key === 'saved' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={on ? 2.2 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {ICONS[l.key]}
            </svg>
            <span className="app-tabbar__label">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
