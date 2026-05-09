import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Strips trailing " CH", " Ch", " ch" (optionally followed by space + digits) from
// tournament names and cities. This cleans up JeffSackmann-imported names like
// "Miyazaki CH" → "Miyazaki", "San Luis Potosi CH" → "San Luis Potosi".

export async function GET() {
  const result = await pool.query<{ id: string; new_name: string; new_city: string }>(
    `
    update tournaments
    set
      name = trim(regexp_replace(name, '\\s+[Cc][Hh](\\s+\\d+)?$', '')),
      city = trim(regexp_replace(city, '\\s+[Cc][Hh](\\s+\\d+)?$', ''))
    where name ~* '\\s+ch(\\s+\\d+)?$'
       or city ~* '\\s+ch(\\s+\\d+)?$'
    returning
      id,
      name as new_name,
      city as new_city
    `
  );

  return NextResponse.json({
    ok: true,
    updatedCount: result.rowCount,
    updated: result.rows,
  });
}
