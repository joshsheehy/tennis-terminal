import { NextRequest, NextResponse } from 'next/server';
import { isValidEmail, normalizeCategories, upsertSubscriber } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint (allow-listed in src/middleware.ts) that the /alerts signup
// form posts to. Accepts JSON { email, categories: string[] } or a form-encoded
// body (categories as repeated fields).
export async function POST(request: NextRequest) {
  let email = '';
  let categoriesInput: unknown = [];
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { email?: string; categories?: unknown };
      email = (body.email ?? '').toString();
      categoriesInput = body.categories ?? [];
    } else {
      const form = await request.formData();
      email = (form.get('email') ?? '').toString();
      categoriesInput = form.getAll('categories');
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  email = email.trim();
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: 'Please enter a valid email address.' },
      { status: 400 }
    );
  }

  const categories = normalizeCategories(categoriesInput);

  try {
    await upsertSubscriber(email, categories);
    return NextResponse.json({
      ok: true,
      categories,
      message: "You're signed up. We'll email you 24 hours before each entry deadline.",
    });
  } catch (err) {
    console.error('subscribe failed', err);
    return NextResponse.json(
      { ok: false, error: 'Could not save your subscription. Please try again.' },
      { status: 500 }
    );
  }
}
