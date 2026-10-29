// The site's primary sections, shared by the top nav (website) and the
// bottom tab bar (iOS app) so the two can never list different things.

export type NavKey = 'builder' | 'cuts' | 'alerts' | 'saved';

export const NAV_LINKS: readonly { key: NavKey; href: string; label: string }[] = [
  { key: 'builder', href: '/', label: 'Builder' },
  // Swings (inspiration map) hidden for now — still reachable at /swings.
  { key: 'cuts', href: '/cuts', label: 'Cuts' },
  { key: 'alerts', href: '/alerts', label: 'Alerts' },
  // Signed-out visitors are redirected from /account to /login.
  { key: 'saved', href: '/account', label: 'Saved' },
];

export function isNavActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/cuts') return pathname.startsWith('/cuts') || pathname.startsWith('/tournaments');
  if (href === '/account') return pathname.startsWith('/account') || pathname.startsWith('/login');
  return pathname.startsWith(href);
}

// The iOS app's top bar shows the current screen's name instead of the logo.
export function screenTitle(pathname: string): string {
  const tab = NAV_LINKS.find((l) => isNavActive(l.href, pathname));
  if (tab) return tab.label;
  if (pathname.startsWith('/schedule')) return 'Schedule';
  if (pathname.startsWith('/swings')) return 'Map';
  if (pathname.startsWith('/support')) return 'Support';
  if (pathname.startsWith('/privacy')) return 'Privacy';
  return 'TennisCuts';
}

// The iOS app (Capacitor) appends this to its user agent
// (capacitor.config.json ios.appendUserAgent).
export const APP_USER_AGENT_TOKEN = 'TennisCutsApp';
