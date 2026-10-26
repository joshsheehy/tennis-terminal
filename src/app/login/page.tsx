import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { safeNextPath } from '@/lib/auth-core';
import { currentUserFromCookies } from '@/lib/auth-request';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: nextParam } = await searchParams;
  const next = safeNextPath(nextParam);
  if (await currentUserFromCookies()) redirect(next);

  return (
    <main className="page page--slim">
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Sign in
      </h1>
      <p className="page-lede" style={{ marginBottom: 20 }}>
        Save tournaments to your own schedule and pick it up on any device. We&apos;ll email you a
        6-digit code. There&apos;s no password.
      </p>
      <LoginForm next={next} />
      <p className="page-footnote" style={{ marginTop: 24 }}>
        By signing in you agree to our <a href="/privacy">privacy policy</a>.
      </p>
    </main>
  );
}
