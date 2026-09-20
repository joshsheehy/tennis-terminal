import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { buildDetailSheetIndex, type DetailSheetEdition } from '@/lib/detail-sheet-index';
import { DetailSheetList } from './detail-sheet-list';
import styles from './page.module.css';

// Not linked from anywhere and kept out of search engines. It is also left out of the sitemap and
// robots.txt on purpose: robots.txt is public, so listing it there would advertise the address.
export const metadata: Metadata = {
  title: 'Detail sheets',
  description: 'Every ProTennisLive tournament detail sheet, A to Z.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

async function loadEntries() {
  const editions = await pool.query<DetailSheetEdition>(
    `select t.slug, t.name, t.city, t.country, te.year, te.level, te.source_url
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.status = 'held'`
  );
  // A calendar-discovered event often carries its ProTennisLive code only on a cut snapshot's PDF link.
  const snapshots = await pool.query<{ slug: string; url: string | null }>(
    `select distinct t.slug,
            substring(cs.source_notes from 'protennislive\\.com/posting/[0-9]{4}/[0-9]+') as url
     from cutoff_snapshots cs
     join tournament_editions te on te.id = cs.tournament_edition_id
     join tournaments t on t.id = te.tournament_id
     where cs.source_notes like '%protennislive.com/posting/%'`
  );
  return buildDetailSheetIndex(editions.rows, snapshots.rows);
}

export default async function DetailSheetsPage() {
  const entries = await loadEntries();

  return (
    <main className="page">
      <p className="eyebrow">Reference</p>
      <h1 className="page-title">Detail sheets</h1>
      <p className={styles.note}>
        The official ProTennisLive detail sheet for every ATP Tour and Challenger tournament, A to Z. Each
        tournament links every year it ran.
      </p>
      <DetailSheetList entries={entries} />
    </main>
  );
}
