// Shared fetch for JeffSackmann's tennis_atp CSVs (the calendar + code source
// for historical backfills). raw.githubusercontent occasionally 404s/429s from
// datacenter IPs; jsDelivr mirrors the same repo. Try each until one returns
// the CSV, and report every attempt in the error so the operator sees exactly
// why a season failed.
export async function fetchSackmannCsv(filename: string): Promise<string> {
  // GitHub repos that renamed their default branch from master to main stop
  // serving the old ref entirely — every raw URL 404s, which reads exactly like
  // a missing file. Try both refs on both hosts, plus the jsDelivr form with no
  // ref at all, which resolves whatever the default branch currently is and so
  // survives the next rename without another fix here.
  const urls = [
    `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/${filename}`,
    `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/main/${filename}`,
    `https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp@master/${filename}`,
    `https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp@main/${filename}`,
    `https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp/${filename}`,
  ];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.text();
      errors.push(`${res.status} from ${url}`);
    } catch (err) {
      errors.push(`${err instanceof Error ? err.message : String(err)} from ${url}`);
    }
  }
  throw new Error(`JeffSackmann fetch failed: ${errors.join(' | ')}`);
}
