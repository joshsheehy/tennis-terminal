'use client';

import { useEffect, useRef, useState } from 'react';
import { readRank, writeRank, RANK_EVENT } from './RankVerdict';

// The persistent "my ranking" chip in the nav. One tap to set singles/doubles
// ranks; every cut on the site then answers "would I get in?" via RankVerdict.

export default function NavRank() {
  const [open, setOpen] = useState(false);
  const [singles, setSingles] = useState<string>('');
  const [doubles, setDoubles] = useState<string>('');
  const [saved, setSaved] = useState<number | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      setSaved(readRank('singles'));
      setSingles(readRank('singles')?.toString() ?? '');
      setDoubles(readRank('doubles')?.toString() ?? '');
    };
    sync();
    window.addEventListener(RANK_EVENT, sync);
    return () => window.removeEventListener(RANK_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function save() {
    writeRank('singles', Number(singles) || null);
    writeRank('doubles', Number(doubles) || null);
    setOpen(false);
  }

  return (
    <div className="nav-rank" ref={popRef}>
      <button
        type="button"
        className={`nav-rank__chip${saved != null ? ' nav-rank__chip--set' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Set my ranking"
      >
        {saved != null ? `#${saved}` : 'My rank'}
      </button>
      {open && (
        <div className="nav-rank__pop" role="dialog" aria-label="My ranking">
          <label>
            Singles rank
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={singles}
              onChange={(e) => setSingles(e.target.value)}
              placeholder="e.g. 250"
            />
          </label>
          <label>
            Doubles rank
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={doubles}
              onChange={(e) => setDoubles(e.target.value)}
              placeholder="e.g. 180"
            />
          </label>
          <p className="nav-rank__note">
            Stored on this device only. Every cut on the site turns into
            &ldquo;in / bubble / out&rdquo; for your number.
          </p>
          <button type="button" className="btn btn--primary nav-rank__save" onClick={save}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
