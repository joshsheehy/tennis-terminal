import type { Metadata } from 'next';
import SwingsView from '@/components/swings/SwingsView';
import { SITE_NAME } from '@/lib/brand';
import { getSwingsPageData } from '@/lib/swings-page-data';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { DEFAULT_LEVEL_SCOPE, parseScopeKey } from '@/lib/swings';

export const dynamic = 'force-dynamic';

// ?build=, ?year= and ?scope= variants all collapse to the homepage.
export const metadata: Metadata = { alternates: { canonical: '/' } };

// Home = the swing Builder (the site's main feature). Same view as /swings but
// it lands in Build mode; the in-page toggle still flips to Explore.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; scope?: string }>;
}) {
  const { year: yearParam, scope: scopeParam } = await searchParams;
  const year =
    yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const groups = scopeParam ? parseScopeKey(scopeParam) : DEFAULT_LEVEL_SCOPE;
  const data = await getSwingsPageData(year, groups.length ? groups : DEFAULT_LEVEL_SCOPE);

  return (
    <>
      {/* The Builder is a full-screen map with no visible heading; this gives
          screen readers and search engines the page's name and purpose. */}
      <h1 className="sr-only">{SITE_NAME}: entry cutoffs and season planner for the pro tennis tour</h1>
      <SwingsView data={data} defaultMode="build" />
    </>
  );
}
