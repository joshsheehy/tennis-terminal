import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/brand';

// Stable top-level routes. (Per-tournament pages are deep long-tail and can be
// added here later by querying the catalogue if we want them indexed.)
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' }> = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
    { path: '/swings', priority: 0.9, changeFrequency: 'daily' },
    { path: '/cuts', priority: 0.9, changeFrequency: 'daily' },
    { path: '/schedule', priority: 0.8, changeFrequency: 'weekly' },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
