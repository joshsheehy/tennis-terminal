import { CURRENT_SEASON } from './seasons';

// Where a tournament page's "back" link goes. Callers pass ?from=<path> to
// return you to the view you actually came from — the builder keeps its built
// chain in that URL, so the round trip restores your schedule instead of
// dumping you on /cuts with an empty one.
//
// Only same-site absolute paths are honoured. A protocol-relative "//evil.com"
// or a full "https://…" URL falls back to the default, so `from` can't be
// turned into an open redirect.
export function backLinkFor(
  from: string | undefined | null,
  year: number
): { href: string; label: string } {
  const fallback = {
    href: year !== CURRENT_SEASON ? `/cuts?year=${year}` : '/cuts',
    label: `← Back to ${year} schedule`,
  };
  if (!from || !from.startsWith('/') || from.startsWith('//')) return fallback;
  // A backslash can be read as a path separator by some clients, so "/\evil.com"
  // is treated as hostile too.
  if (from.startsWith('/\\')) return fallback;

  const path = from.split('?')[0];
  if (path === '/') return { href: from, label: '← Back to builder' };
  if (path === '/swings') return { href: from, label: '← Back to the map' };
  if (path === '/schedule') return { href: from, label: '← Back to your schedule' };
  if (path === '/cuts') return { href: from, label: `← Back to ${year} schedule` };
  return { href: from, label: '← Back' };
}
