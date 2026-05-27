import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement scrollTo; the picker calls it on mount.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// next/link pulls in router internals that aren't needed in unit tests —
// render it as a plain anchor.
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href, ...props }: { children: React.ReactNode; href: unknown }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  };
});

afterEach(() => cleanup());
