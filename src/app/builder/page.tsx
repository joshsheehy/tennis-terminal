import SwingsView from '@/components/swings/SwingsView';
import { getSwingsPageData } from '@/lib/swings-page-data';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { DEFAULT_LEVEL_SCOPE, parseScopeKey } from '@/lib/swings';

export const dynamic = 'force-dynamic';

// The swing Builder (moved from / — the home page is now the landing page).
// it lands in Build mode; the in-page toggle still flips to Explore.
export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; scope?: string }>;
}) {
  const { year: yearParam, scope: scopeParam } = await searchParams;
  const year =
    yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const groups = scopeParam ? parseScopeKey(scopeParam) : DEFAULT_LEVEL_SCOPE;
  const data = await getSwingsPageData(year, groups.length ? groups : DEFAULT_LEVEL_SCOPE);

  return <SwingsView data={data} defaultMode="build" />;
}
