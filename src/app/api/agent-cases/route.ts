import { NextRequest, NextResponse } from 'next/server';
import { caseEvents, listCases, syncFindings, updateCase, type CaseStatus, type Finding } from '@/lib/agent-cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The audit bot's case ledger. Protected by the admin secret like every /api route (see middleware.ts):
//   GET  /api/agent-cases?status=open,escalated&limit=30   list, with counts by status
//   GET  /api/agent-cases?id=12                            one case with its history
//   POST { action: 'sync', source, ran: [...], findings: [...] }   what the audit found this run
//   POST { action: 'update', id|key, status?, note?, actor, attempt?, markNotified? }

const STATUSES: CaseStatus[] = ['open', 'in_progress', 'fixed', 'escalated', 'acknowledged'];

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const status = (p.get('status') ?? '').split(',').filter((s): s is CaseStatus => STATUSES.includes(s as CaseStatus));
  const id = p.get('id') ? Number(p.get('id')) : undefined;
  const result = await listCases({
    status: status.length ? status : undefined,
    id: Number.isInteger(id) ? id : undefined,
    key: p.get('key') ?? undefined,
    fixedWithinDays: p.get('fixedWithinDays') ? Number(p.get('fixedWithinDays')) : undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : undefined,
  });
  const events = result.cases.length === 1 ? await caseEvents(result.cases[0].id) : undefined;
  return NextResponse.json({ ok: true, ...result, events });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }

  if (body.action === 'sync') {
    const findings = Array.isArray(body.findings) ? (body.findings as Finding[]) : null;
    const ran = Array.isArray(body.ran) ? (body.ran as unknown[]).filter((r): r is string => typeof r === 'string') : null;
    if (!findings || !ran || typeof body.source !== 'string') {
      return NextResponse.json({ ok: false, error: 'sync needs source, ran[] and findings[].' }, { status: 400 });
    }
    const valid = findings.every(
      (f) => f && typeof f.key === 'string' && f.key && (f.severity === 'critical' || f.severity === 'warn') && typeof f.title === 'string' && typeof f.text === 'string'
    );
    if (!valid) return NextResponse.json({ ok: false, error: 'Each finding needs key, severity (critical|warn), title and text.' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await syncFindings({ source: body.source, ran, findings })) });
  }

  if (body.action === 'update') {
    const status = body.status as CaseStatus | undefined;
    if (status !== undefined && !STATUSES.includes(status)) return NextResponse.json({ ok: false, error: 'Unknown status.' }, { status: 400 });
    if (typeof body.actor !== 'string' || (body.id == null && typeof body.key !== 'string')) {
      return NextResponse.json({ ok: false, error: 'update needs actor and an id or key.' }, { status: 400 });
    }
    const updated = await updateCase({
      id: body.id != null ? Number(body.id) : undefined,
      key: typeof body.key === 'string' ? body.key : undefined,
      status,
      actor: body.actor,
      note: typeof body.note === 'string' ? body.note : undefined,
      attempt: body.attempt === true,
      markNotified: body.markNotified === true,
    });
    if (!updated) return NextResponse.json({ ok: false, error: 'No such case.' }, { status: 404 });
    return NextResponse.json({ ok: true, case: updated });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
