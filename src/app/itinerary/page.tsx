import type { Metadata } from 'next';
import Link from 'next/link';
import ItineraryView from '@/components/swings/ItineraryView';
import { getSwingsPageData } from '@/lib/swings-page-data';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { ALL_LEVEL_GROUPS } from '@/lib/swings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your swing',
  description: 'Your planned tournament schedule with flight search between stops.',
  robots: { index: false, follow: false },
};

// The finished-swing screen. The built chain arrives as ?build=<edition ids>
// (the same encoding the Builder uses), so a finished swing is shareable by URL.
export default async function ItineraryPage({
  searchParams,
}: {
  searchParams: Promise<{ build?: string; year?: string }>;
}) {
  const { build, year: yearParam } = await searchParams;
  const year =
    yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const ids = (build ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  // Resolve across every level so an ITF/Challenger/ATP mix all come back,
  // regardless of which filter was active while building.
  const data = ids.length ? await getSwingsPageData(year, [...ALL_LEVEL_GROUPS]) : null;
  const byId = new Map(data?.events.map((e) => [e.editionId, e]) ?? []);
  const stops = ids.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);

  if (stops.length === 0) {
    return (
      <main
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '32px 16px',
          minHeight: 'calc(100dvh - var(--nav-h))',
          color: 'var(--text)',
        }}
      >
        <h1 style={{ marginTop: 0 }}>No swing to show</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Build a swing first, then press “Finish &amp; plan travel”.
        </p>
        <Link href="/" style={{ color: 'var(--accent, #0284c7)', textDecoration: 'underline' }}>
          ← Back to the builder
        </Link>
      </main>
    );
  }

  return <ItineraryView stops={stops} year={year} />;
}
