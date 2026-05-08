import { NextResponse } from 'next/server';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MissingCodeEvent = {
  week: number | null;
  level: string;
  slug: string;
  name: string;
  city: string;
  start_date: string;
  atpResultsArchiveSearchUrl: string | null;
  googleSearchUrl: string;
  protennisliveCandidateUrlTemplate: string;
};

function buildGoogleSearchUrl(eventName: string) {
  const query = `site:protennislive.com/posting/2026 "${eventName}" mds.pdf`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function buildAtpResultsArchiveSearchUrl(level: string) {
  if (!level.startsWith('ATP')) {
    return null;
  }

  return 'https://www.atptour.com/en/scores/results-archive?year=2026';
}

export async function GET() {
  const missingCodes: MissingCodeEvent[] = ALL_EDITIONS
    .filter((item) => item.edition.status === 'held' && item.edition.year === 2026 && item.edition.protennislive_code === null)
    .map((item) => ({
      week: item.edition.week,
      level: item.edition.level,
      slug: item.tournament.slug,
      name: item.tournament.name,
      city: item.tournament.city,
      start_date: item.edition.start_date,
      atpResultsArchiveSearchUrl: buildAtpResultsArchiveSearchUrl(item.edition.level),
      googleSearchUrl: buildGoogleSearchUrl(item.tournament.name),
      protennisliveCandidateUrlTemplate: 'https://www.protennislive.com/posting/2026/{CODE}/mds.pdf',
    }))
    .sort((a, b) => {
      const weekA = a.week ?? Number.MAX_SAFE_INTEGER;
      const weekB = b.week ?? Number.MAX_SAFE_INTEGER;
      if (weekA !== weekB) return weekA - weekB;
      if (a.level !== b.level) return a.level.localeCompare(b.level);
      if (a.slug !== b.slug) return a.slug.localeCompare(b.slug);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      if (a.city !== b.city) return a.city.localeCompare(b.city);
      return a.start_date.localeCompare(b.start_date);
    });

  return NextResponse.json({
    ok: true,
    count: missingCodes.length,
    missingCodes,
  });
}
