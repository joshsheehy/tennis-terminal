import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ensureSubscriberTables } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin endpoint (behind the middleware admin-secret gate): everyone who has
// ever signed up for deadline alerts, with their category picks, status, and
// how many alert emails they've been sent. Read-only.
export async function GET() {
  await ensureSubscriberTables();

  const result = await pool.query<{
    email: string;
    active: boolean;
    categories: string[];
    created_at: string;
    unsubscribed_at: string | null;
    emails_sent: string;
    last_alert_at: string | null;
  }>(
    `
    select
      s.email,
      s.active,
      s.categories,
      s.created_at,
      s.unsubscribed_at,
      count(a.id) as emails_sent,
      max(a.sent_at) as last_alert_at
    from alert_subscribers s
    left join alert_sends a on a.subscriber_id = s.id
    group by s.id
    order by s.created_at desc
    `
  );

  const subscribers = result.rows.map((r) => ({
    ...r,
    emails_sent: Number(r.emails_sent),
  }));

  return NextResponse.json({
    ok: true,
    total: subscribers.length,
    active: subscribers.filter((s) => s.active).length,
    unsubscribed: subscribers.filter((s) => !s.active).length,
    subscribers,
  });
}
