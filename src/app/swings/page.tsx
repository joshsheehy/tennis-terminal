import SwingsView from '@/components/swings/SwingsView';
import { getSwingsPageData } from '@/lib/swings-page-data';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { DEFAULT_LEVEL_SCOPE, parseScopeKey } from '@/lib/swings';

export const dynamic = 'force-dynamic';

// Swings = the inspiration view: explore detected travel chains on the map.
// Lands in Explore mode; the in-page toggle flips to Build. Filters sync to URL
// params: /swings?year=2026&scope=atp+challenger&surface=Clay
export default async function SwingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; scope?: string }>;
}) {
  const { year: yearParam, scope: scopeParam } = await searchParams;
  const year =
    yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const groups = scopeParam ? parseScopeKey(scopeParam) : DEFAULT_LEVEL_SCOPE;
  const data = await getSwingsPageData(year, groups.length ? groups : DEFAULT_LEVEL_SCOPE);

  return <SwingsView data={data} defaultMode="explore" />;
}
