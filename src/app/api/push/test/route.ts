import { NextRequest, NextResponse } from 'next/server';
import { ApnsClient, apnsConfigured } from '@/lib/apns';
import { currentUser, rejectUnsafeWrite, unauthorized } from '@/lib/auth-request';
import { deleteDeviceToken, listUserDevices, rememberDeviceEnv } from '@/lib/push-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts), signed-in only: send a
// test notification to the caller's own devices — the end-to-end check that
// doesn't wait for a real deadline window. One per account per 30 seconds.
const COOLDOWN_MS = 30_000;
const lastTest = new Map<string, number>();

export async function POST(request: NextRequest) {
  const blocked = rejectUnsafeWrite(request);
  if (blocked) return blocked;
  const user = await currentUser(request);
  if (!user) return unauthorized();

  if (!apnsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Push isn't set up on the server yet (APNs key missing)." },
      { status: 503 }
    );
  }
  const since = Date.now() - (lastTest.get(user.id) ?? 0);
  if (since < COOLDOWN_MS) {
    return NextResponse.json({ ok: false, error: 'Give it a few seconds before sending another.' }, { status: 429 });
  }
  lastTest.set(user.id, Date.now());

  const devices = await listUserDevices(user.id);
  if (devices.length === 0) {
    return NextResponse.json({ ok: false, error: 'Turn on push notifications first.' }, { status: 400 });
  }

  const client = new ApnsClient();
  const results: Array<{ ok: boolean; reason?: string }> = [];
  try {
    for (const device of devices) {
      const outcome = await client.send(
        device.token,
        { title: 'TennisCuts test', body: 'Push notifications are working. Deadline alerts will look like this.', url: '/alerts' },
        device.env
      );
      if (outcome.ok) {
        if (outcome.env !== device.env) await rememberDeviceEnv(device.token, outcome.env);
        results.push({ ok: true });
      } else {
        if (outcome.gone) await deleteDeviceToken(device.token);
        console.error(`[push/test] ${outcome.status} ${outcome.reason}`);
        results.push({ ok: false, reason: outcome.reason || `HTTP ${outcome.status}` });
      }
    }
  } finally {
    client.close();
  }

  const sent = results.filter((r) => r.ok).length;
  if (sent === 0) {
    return NextResponse.json(
      { ok: false, error: `Apple didn't accept the notification (${results[0]?.reason ?? 'unknown'}).` },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sent });
}
