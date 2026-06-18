'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Global top nav across the whole site. Three destinations:
//   Builder (/)  — the main feature: build your own swing
//   Swings (/swings) — the inspiration map (Explore mode by default)
//   Cuts (/cuts) — the original tournament calendar / entry cuts
const LINKS = [
  { href: '/', label: 'Builder' },
  { href: '/swings', label: 'Swings' },
  { href: '/cuts', label: 'Cuts' },
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  // Treat /tournaments/* as part of the Cuts section so a link stays lit.
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/cuts') return pathname.startsWith('/cuts') || pathname.startsWith('/tournaments');
    return pathname.startsWith(href);
  };

  return (
    <nav className="site-nav" aria-label="Primary">
      <Link href="/" className="site-nav__brand">
        Tennis Cuts
      </Link>
      <div className="site-nav__links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? 'page' : undefined}
            className={`site-nav__link${isActive(l.href) ? ' site-nav__link--on' : ''}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
