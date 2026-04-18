import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-12">
      <div className="space-y-5">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">Tennis Terminal</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Can I get into this tournament?</h1>
        <p className="max-w-2xl text-neutral-400">
          V1 starts with official-source-backed ATP Tour and Challenger calendar imports, then adds cutoff history and checker logic.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/schedule" className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-900">
            Open schedule
          </Link>
          <Link href="/checker" className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-900">
            Open checker
          </Link>
        </div>
      </div>
    </main>
  );
}
