import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only inspector that surfaces every tournament where the stored level
// varies across years. Some hits are legitimate promotions/demotions that
// already have explicit historical entries in tournament-data.ts (Dallas,
// Newport, Marseille, Brussels, etc.); others are import bugs where an
// automated source backfilled a historical year with the current year's
// level. This is the systematic way to find the "Dallas 2024 was actually
// ATP 250" cases without external API access.
//
// Use:
//   GET /api/inspect-level-changes
//
// Response groups every (slug, level, year-list) combination so the
// operator can scan for tournaments that look like they need a historical
// edition added or corrected.

type Row = {
  slug: string;
  name: string;
  city: string;
  year: number;
  level: string;
  status: string;
};

export async function GET() {
  const result = await pool.query<Row>(
    `select t.slug, t.name, t.city, te.year, te.level, te.status
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held'
     order by t.slug, te.year`
  );

  const bySlug = new Map<
    string,
    { name: string; city: string; entries: Array<{ year: number; level: string }> }
  >();
  for (const row of result.rows) {
    const existing = bySlug.get(row.slug);
    if (existing) {
      existing.entries.push({ year: row.year, level: row.level });
    } else {
      bySlug.set(row.slug, {
        name: row.name,
        city: row.city,
        entries: [{ year: row.year, level: row.level }],
      });
    }
  }

  type Hit = {
    slug: string;
    tournament: string;
    city: string;
    levels: string[];
    yearLevels: Array<{ year: number; level: string }>;
  };

  const hits: Hit[] = [];
  for (const [slug, info] of bySlug) {
    const levels = Array.from(new Set(info.entries.map((e) => e.level)));
    if (levels.length < 2) continue;
    hits.push({
      slug,
      tournament: info.name,
      city: info.city,
      levels,
      yearLevels: info.entries,
    });
  }

  hits.sort((a, b) => a.slug.localeCompare(b.slug));

  return NextResponse.json({
    ok: true,
    foundCount: hits.length,
    note: 'Tournaments whose stored level varies across years. Some are legitimate level transitions (Dallas: ATP 250 → 500; Newport: ATP 250 → Challenger 125; Marseille: ATP 250 → discontinued). Others are import bugs that need an explicit historical entry in tournament-data.ts.',
    hits,
  });
}
