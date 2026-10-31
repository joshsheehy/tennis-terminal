import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/brand';
import { getScheduleForYear } from '@/lib/db';
import { CURRENT_SEASON } from '@/lib/seasons';

// Built per request: the database isn't reachable at build time, and a
// prerendered sitemap would freeze the tournament list at the last deploy.
export const dynamic = 'force-dynamic';

// Stable top-level routes. /schedule (needs a ?build= link) and /swings
// (hidden, canonical to /) are left out on purpose.
const ROUTES: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' }> = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/cuts', priority: 0.9, changeFrequency: 'daily' },
  { path: '/alerts', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/support', priority: 0.3, changeFrequency: 'weekly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'weekly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  }));

  // One URL per tournament for this season and next: the page's canonical is
  // /tournaments/<slug> whatever ?year= is viewed, so no year param here.
  try {
    const seasons = await Promise.all([
      getScheduleForYear(CURRENT_SEASON),
      getScheduleForYear(CURRENT_SEASON + 1).catch(() => []),
    ]);
    const slugs = new Set(seasons.flat().map((row) => row.slug));
    for (const slug of slugs) {
      pages.push({ url: `${SITE_URL}/tournaments/${encodeURIComponent(slug)}`, changeFrequency: 'weekly', priority: 0.7 });
    }
  } catch (error) {
    console.error('[sitemap] tournament list failed; serving top-level routes only', error);
  }
  return pages;
}
