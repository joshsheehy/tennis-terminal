import { NextRequest, NextResponse } from 'next/server';
import {
  getSubscriberByToken,
  normalizeCategories,
  updateCategoriesByToken,
} from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts). Reached from the "Edit
// preferences" link in every alert email: it reads/updates which categories a
// subscriber wants, identified by the token from that link.
//
//   GET  /api/preferences?token=...            -> { email, categories }
//   POST /api/preferences  { token, categories } -> updates and returns them
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const sub = await getSubscriberByToken(token);
  if (!sub) {
    return NextResponse.json({ ok: false, error: 'Unknown or expired link.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, email: sub.email, categories: sub.categories });
}

export async function POST(request: NextRequest) {
  let token = '';
  let categoriesInput: unknown = [];
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: string; categories?: unknown };
      token = (body.token ?? '').toString();
      categoriesInput = body.categories ?? [];
    } else {
      const form = await request.formData();
      token = (form.get('token') ?? '').toString();
      categoriesInput = form.getAll('categories');
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const categories = normalizeCategories(categoriesInput);
  const updated = await updateCategoriesByToken(token.trim(), categories);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Unknown or expired link.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    email: updated.email,
    categories: updated.categories,
    message: 'Your alert preferences have been updated.',
  });
}
