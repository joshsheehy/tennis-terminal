'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', label: 'Builder' },
  { href: '/swings', label: 'Swings' },
  { href: '/cuts', label: 'Cuts' },
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      setIsDark(stored === 'dark');
    } else {
      setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);

  function toggleTheme() {
    const next = !isDark;
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDark(next);
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/cuts') return pathname.startsWith('/cuts') || pathname.startsWith('/tournaments');
    return pathname.startsWith(href);
  };

  return (
    <nav className="site-nav" aria-label="Primary">
      <Link href="/" className="site-nav__brand" aria-label="Tennis Cuts — home">
        <svg className="site-nav__logo" width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect x="13" y="12" width="23" height="40" rx="4" stroke="currentColor" strokeWidth="3" />
          <line x1="13" y1="32" x2="36" y2="32" stroke="currentColor" strokeWidth="2.4" />
          <line x1="24.5" y1="22" x2="24.5" y2="42" stroke="currentColor" strokeWidth="2.4" />
          <polyline points="11,47 21,39 28,41 37,22" stroke="#3CB043" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="37" cy="22" r="4" fill="var(--surface)" stroke="#3CB043" strokeWidth="2.6" />
        </svg>
        <span>
          Tennis<span className="site-nav__brand-cut">Cuts</span>
        </span>
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
      {isDark !== null && (
        <button
          className="site-nav__theme"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? '☀︎' : '☾︎'}
        </button>
      )}
    </nav>
  );
}
