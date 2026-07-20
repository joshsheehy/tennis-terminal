import Link from 'next/link';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The front door. Everything a player needs to decide in ten seconds whether
// this is for them: what it does, proof it's real, and one obvious next step.
// The numbers are live from the database — a marketing page with fake stats
// would undercut the whole pitch.

async function liveStats() {
  try {
    const [editions, cuts] = await Promise.all([
      pool.query<{ n: string }>(
        `select count(*) as n from tournament_editions where status = 'held'`
      ),
      pool.query<{ n: string }>(
        `select count(*) as n from cutoff_snapshots
          where coalesce(last_alternate_rank, last_direct_acceptance_rank,
                         challenger_doubles_advanced_cut_rank) is not null`
      ),
    ]);
    return {
      editions: Number(editions.rows[0]?.n ?? 0),
      cuts: Number(cuts.rows[0]?.n ?? 0),
    };
  } catch {
    return { editions: null, cuts: null };
  }
}

function fmt(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

export default async function HomePage() {
  const stats = await liveStats();

  return (
    <main className="landing">
      <section className="landing__hero">
        <p className="eyebrow">TennisCuts</p>
        <h1 className="landing__title">
          Know the cut <span className="landing__title-accent">before you enter.</span>
        </h1>
        <p className="landing__lede">
          Real entry cuts for every ATP, Challenger and ITF event — five seasons deep —
          plus projections up to eight weeks out and deadline emails that land before
          entries close. Built for players planning a schedule, not for fans.
        </p>
        <div className="landing__ctas">
          <Link href="/builder" className="btn btn--primary landing__cta">
            Plan my schedule →
          </Link>
          <Link href="/cuts" className="btn landing__cta-secondary">
            Browse the cuts
          </Link>
        </div>
        <dl className="landing__stats" aria-label="Live coverage">
          <div>
            <dt>Tournament editions</dt>
            <dd>{fmt(stats.editions)}</dd>
          </div>
          <div>
            <dt>Real cuts on record</dt>
            <dd>{fmt(stats.cuts)}</dd>
          </div>
          <div>
            <dt>Seasons of history</dt>
            <dd>5</dd>
          </div>
          <div>
            <dt>Projection horizon</dt>
            <dd>8 wks</dd>
          </div>
        </dl>
      </section>

      <section className="landing__grid" aria-label="What you get">
        <article className="landing__card">
          <h2>Every cut, sourced</h2>
          <p>
            Last direct acceptance and the post-alternate cut for singles main, qualifying
            and doubles — parsed from official acceptance lists, not guessed from forums.
            Slams included.
          </p>
          <Link href="/cuts">See the calendar →</Link>
        </article>
        <article className="landing__card">
          <h2>Projections you can plan on</h2>
          <p>
            Beta cut projections up to eight weeks out, each with an honest range —
            backtested walk-forward against five seasons and beating &ldquo;same as last
            year&rdquo; by 14–20% across draws.
          </p>
          <Link href="/builder">Try the builder →</Link>
        </article>
        <article className="landing__card">
          <h2>Deadlines, handled</h2>
          <p>
            One email 24, 12 and/or 2 hours before every ATP, Challenger, ITF and Grand
            Slam entry deadline you care about — singles and doubles, sectioned and
            sorted by level.
          </p>
          <Link href="/alerts">Set up alerts →</Link>
        </article>
      </section>

      <section className="landing__how" aria-label="How it works">
        <h2 className="landing__how-title">Three steps to a smarter schedule</h2>
        <ol className="landing__steps">
          <li>
            <span className="landing__step-n">1</span>
            <div>
              <h3>Enter your ranking</h3>
              <p>Singles and doubles. It stays on your device — no account needed.</p>
            </div>
          </li>
          <li>
            <span className="landing__step-n">2</span>
            <div>
              <h3>Build your swing</h3>
              <p>
                Tap through the calendar week by week and see, for every draw, whether
                your number would have made it — and what the projection says this year.
              </p>
            </div>
          </li>
          <li>
            <span className="landing__step-n">3</span>
            <div>
              <h3>Enter on time</h3>
              <p>
                Deadline emails arrive before entries close, with your doubles advance
                entries covered too.
              </p>
            </div>
          </li>
        </ol>
        <div className="landing__ctas landing__ctas--end">
          <Link href="/builder" className="btn btn--primary landing__cta">
            Start building →
          </Link>
        </div>
      </section>
    </main>
  );
}
