import { NextRequest, NextResponse } from 'next/server';
import { listSavedEditionIds, saveEditions, unsaveEditions } from '@/lib/accounts';
import { parseEditionIds } from '@/lib/auth-core';
import { NO_STORE, currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts), but every method needs
// a signed-in user. Body for POST/DELETE: { editionIds: string[] }.

export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  return NextResponse.json({ ok: true, savedEditionIds: await listSavedEditionIds(user.id) }, { headers: NO_STORE });
}

async function readIds(request: NextRequest): Promise<string[] | null> {
  try {
    const body = (await request.json()) as { editionIds?: unknown };
    const ids = parseEditionIds(body.editionIds);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const ids = await readIds(request);
  if (!ids) return NextResponse.json({ ok: false, error: 'No tournaments to save.' }, { status: 400 });
  const added = await saveEditions(user.id, ids);
  return NextResponse.json(
    { ok: true, added, savedEditionIds: await listSavedEditionIds(user.id) },
    { headers: NO_STORE }
  );
}

export async function DELETE(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const ids = await readIds(request);
  if (!ids) return NextResponse.json({ ok: false, error: 'No tournaments to remove.' }, { status: 400 });
  const removed = await unsaveEditions(user.id, ids);
  return NextResponse.json(
    { ok: true, removed, savedEditionIds: await listSavedEditionIds(user.id) },
    { headers: NO_STORE }
  );
}
