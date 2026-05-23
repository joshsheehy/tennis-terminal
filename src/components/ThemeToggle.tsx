'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      setIsDark(stored === 'dark');
    } else {
      setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);

  if (isDark === null) return null;

  function toggle() {
    const next = !isDark;
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '7px 11px',
        cursor: 'pointer',
        fontSize: 17,
        color: 'var(--text-muted)',
        lineHeight: 1,
      }}
    >
      {isDark ? '☀︎' : '☾︎'}
    </button>
  );
}
