import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runDepthValidation } from '@/lib/depth-validate';
import type { Discipline } from '@/lib/depth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// JSON view of the depth validation gate. The computation lives in
// src/lib/depth-validate.ts so /depth renders the same numbers.
//
//   GET /api/depth-validate                    → both disciplines, all checks
//   GET /api/depth-validate?discipline=doubles → one discipline
//   GET /api/depth-validate?year=2025&week=36  → V4 intermediates for one week

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const only = params.get('discipline');
  const disciplines: Discipline[] | undefined =
    only === 'singles' || only === 'doubles' ? [only] : undefined;
  const year = params.get('year');
  const week = params.get('week');

  const report = await runDepthValidation(pool, {
    disciplines,
    year: year ? Number(year) : undefined,
    week: week ? Number(week) : undefined,
  });
  return NextResponse.json(report);
}
