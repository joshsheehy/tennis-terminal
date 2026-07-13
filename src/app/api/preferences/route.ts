import { NextRequest, NextResponse } from 'next/server';
import { normalizeReminderHours } from '@/lib/entry-deadlines';
import {
  getSubscriberByToken,
  parseSelection,
  updateCategoriesByToken,
} from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts). Reached from the "Edit
// preferences" link in every alert email: it reads/updates which categories a
// subscriber wants, identified by the token from that link.
//
//   GET  /api/preferences?token=...  -> { email, categories, includeDoubles }
//   POST /api/preferences  { token, categories, doubles } -> updates them
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const sub = await getSubscriberByToken(token);
  if (!sub) {
    return NextResponse.json({ ok: false, error: 'Unknown or expired link.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    email: sub.email,
    categories: sub.categories,
    includeDoubles: sub.include_doubles,
    reminderHours: sub.reminder_hours,
  });
}

export async function POST(request: NextRequest) {
  let token = '';
  let categoriesInput: unknown = [];
  let doublesFlag: unknown = undefined;
  let reminderInput: unknown = null;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as {
        token?: string;
        categories?: unknown;
        doubles?: unknown;
        reminderHours?: unknown;
      };
      token = (body.token ?? '').toString();
      categoriesInput = body.categories ?? [];
      doublesFlag = body.doubles;
      reminderInput = body.reminderHours ?? null;
    } else {
      const form = await request.formData();
      token = (form.get('token') ?? '').toString();
      categoriesInput = form.getAll('categories');
      doublesFlag = form.get('doubles') === 'on' || undefined;
      reminderInput = form.has('reminderHours') ? form.getAll('reminderHours') : null;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { categories, includeDoubles } = parseSelection(categoriesInput, doublesFlag);
  // A body without reminderHours leaves the stored windows unchanged.
  const reminderHours = reminderInput == null ? null : normalizeReminderHours(reminderInput);
  const updated = await updateCategoriesByToken(token.trim(), categories, includeDoubles, reminderHours);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Unknown or expired link.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    email: updated.email,
    categories: updated.categories,
    includeDoubles: updated.include_doubles,
    reminderHours: updated.reminder_hours,
    message: 'Your alert preferences have been updated.',
  });
}
