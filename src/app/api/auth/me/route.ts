import { NextRequest, NextResponse } from 'next/server';
import { listSavedEditionIds } from '@/lib/accounts';
import { NO_STORE, currentUser } from '@/lib/auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts): who is signed in, and
// which editions they've saved. Signed-out callers get { user: null } rather
// than a 401 so the save buttons can render without an error path.
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ ok: true, user: null, savedEditionIds: [] }, { headers: NO_STORE });
  const savedEditionIds = await listSavedEditionIds(user.id);
  return NextResponse.json({ ok: true, user: { email: user.email }, savedEditionIds }, { headers: NO_STORE });
}
