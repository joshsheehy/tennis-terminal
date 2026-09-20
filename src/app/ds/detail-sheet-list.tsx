'use client';

import { useMemo, useState } from 'react';
import { filterDetailSheets, type DetailSheetEntry } from '@/lib/detail-sheet-index';
import styles from './page.module.css';

export function DetailSheetList({ entries }: { entries: DetailSheetEntry[] }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterDetailSheets(entries, query), [entries, query]);

  return (
    <>
      <div className={styles.searchBar}>
        <div className="search-wrap">
          <input
            className="search-input"
            type="text"
            inputMode="search"
            autoComplete="off"
            autoFocus
            placeholder="Search by tournament, city, country or level"
            aria-label="Search detail sheets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
        <p className={styles.count} aria-live="polite">
          {query.trim() ? `${shown.length} of ${entries.length}` : `${entries.length}`} tournaments
        </p>
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>No tournaments match “{query.trim()}”.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((entry) => (
            <li key={entry.slug} className={styles.row}>
              <div className={styles.who}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.meta}>
                  {entry.place ? `${entry.place} · ` : ''}
                  {entry.level}
                </span>
              </div>
              <div className={styles.sheets}>
                {entry.sheets.map((sheet, index) => (
                  <a
                    key={sheet.year}
                    href={sheet.url}
                    target="_blank"
                    rel="noreferrer"
                    className={index === 0 ? styles.chip : `${styles.chip} ${styles.chipOlder}`}
                  >
                    {sheet.year} ↗
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
