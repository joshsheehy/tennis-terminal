'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '@/lib/account-client';
import type { TournamentSearchResult } from '@/lib/tournament-search';

// Search any tournament, past or future, and add it to Saved — shown on the
// Saved page in Edit mode.

function badge(start: string) {
  const d = new Date(`${start}T00:00:00Z`);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
    day: String(d.getUTCDate()),
  };
}

function displayName(name: string) {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

export default function AddTournamentPicker({ savedIds, onClose }: { savedIds: string[]; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TournamentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set(savedIds));
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Debounced search; a newer keystroke cancels the older request.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tournament-search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = (await response.json()) as { ok: boolean; results?: TournamentSearchResult[]; error?: string };
        setResults(data.results ?? []);
        setError(data.ok ? null : data.error ?? 'Search failed.');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError("Couldn't search right now.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  async function add(id: string) {
    setAdding(id);
    const result = await accountApi('/api/saved', 'POST', { editionIds: [id] });
    setAdding(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdded((prev) => new Set(prev).add(id));
    router.refresh();
  }

  return (
    <div className="add-picker">
      <div className="add-picker__head">
        <input
          ref={inputRef}
          type="search"
          className="field-input add-picker__input"
          placeholder="Search tournament or city"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tournaments to add"
        />
        <button type="button" className="link-button add-picker__close" onClick={onClose}>
          Close
        </button>
      </div>
      {error && (
        <p role="alert" className="form-status form-status--error">
          {error}
        </p>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && !error && (
        <p className="add-picker__hint">No tournaments match &ldquo;{query.trim()}&rdquo;.</p>
      )}
      {query.trim().length < 2 && <p className="add-picker__hint">Type at least 2 letters. Past and future editions both show up.</p>}
      {results.length > 0 && (
        <ul className="saved-list add-picker__list">
          {results.map((r) => {
            const b = badge(r.start);
            const isAdded = added.has(r.editionId);
            return (
              <li key={r.editionId} className="saved-row">
                <div className="saved-row__link">
                  <span className="saved-row__date" aria-hidden="true">
                    <span className="saved-row__month">{b.month}</span>
                    <span className="saved-row__day">{b.day}</span>
                  </span>
                  <span className="saved-row__body">
                    <span className="saved-row__name">{displayName(r.name)}</span>
                    <span className="saved-row__meta">
                      {r.year} · {r.city}
                      {r.country ? `, ${r.country}` : ''} · {r.level}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className={`add-picker__add${isAdded ? ' add-picker__add--done' : ''}`}
                  onClick={() => add(r.editionId)}
                  disabled={isAdded || adding === r.editionId}
                  aria-label={isAdded ? `${displayName(r.name)} ${r.year} is saved` : `Add ${displayName(r.name)} ${r.year}`}
                >
                  {isAdded ? 'Added' : adding === r.editionId ? '…' : '+ Add'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
