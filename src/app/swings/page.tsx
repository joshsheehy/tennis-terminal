import './swings.css';
import SwingsView from '@/components/swings/SwingsView';
import { getSwingsPageData } from '@/lib/swings-page-data';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { DEFAULT_LEVEL_SCOPE, parseScopeKey } from '@/lib/swings';

export const dynamic = 'force-dynamic';

// Phase 3 dark launch: the /swings map view lives here and is not yet linked
// from anywhere (the nav link is Phase 4). Filters sync to URL params:
// /swings?year=2026&scope=atp+challenger&surface=Clay
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

  return <SwingsView data={data} />;
}
