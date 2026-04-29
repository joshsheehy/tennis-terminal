import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <div className="space-y-4">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">
          Tennis Terminal
        </p>

        <h1 className="text-4xl font-semibold tracking-tight">
          Tournament calendar and historical cut data
        </h1>

        <p className="max-w-xl text-neutral-400">
          Browse the schedule, open a tournament, and view historical cut information.
        </p>

        <div className="pt-4">
          <Link
            href="/schedule"
            className="inline-flex rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900"
          >
            Open schedule
          </Link>
        </div>
      </div>
    </main>
  );
}
