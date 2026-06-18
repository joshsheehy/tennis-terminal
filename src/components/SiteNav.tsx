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
