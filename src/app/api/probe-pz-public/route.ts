import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Temporary, protected diagnostic. Hard-coded so it cannot be used as an
// arbitrary fetch proxy. This tests whether Railway can reach the modern ATP
// PlayerZone report renderer that our GitHub runner cannot reach.
const TARGETS = [
  ['modernP', 'https://ps-site.atppz.com/Singles/AcceptanceList/2026/3121/P'],
  ['modernD', 'https://ps-site.atppz.com/Singles/AcceptanceList/2026/3121/D'],
] as const;

export async function GET() {
  const results: Array<Record<string, unknown>> = [];

  for (const [name, url] of TARGETS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          accept: 'text/html,application/pdf,*/*',
          'user-agent': 'Mozilla/5.0 (compatible; TennisCutsPublicSourceProbe/1.0)',
        },
        signal: controller.signal,
      });
      const body = Buffer.from(await response.arrayBuffer());
      const text = body.subarray(0, 200_000).toString('utf8');
      const markers = ['Official Player', 'Acceptance List', 'Original Cut Off', 'Alternates', 'Ranking Date', 'Login', 'Sign In']
        .filter((marker) => text.toLowerCase().includes(marker.toLowerCase()));
      results.push({
        name,
        status: response.status,
        contentType: response.headers.get('content-type'),
        location: response.headers.get('location'),
        bytes: body.length,
        pdf: body.subarray(0, 4).toString() === '%PDF',
        markers,
      });
    } catch (error) {
      results.push({
        name,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return NextResponse.json({ ok: true, results });
}
