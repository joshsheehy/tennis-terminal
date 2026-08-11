import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runItfBacktest } from '@/lib/itf-backtest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Does regional ITF supply move a Challenger cut? Read-only; writes nothing and
// changes no prediction. The ITF drain only gets wired into the projection if
// this comes back with the predicted positive sign AND beats the "same cut as
// last year" baseline on held-out seasons.
//
//   GET /api/itf-validate

export async function GET() {
  return NextResponse.json(await runItfBacktest(pool));
}
