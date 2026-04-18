'use client';

import { useMemo, useState } from 'react';
import { CheckerResult, ScheduleRow } from '@/lib/types';

type Props = {
  tournament: ScheduleRow;
  singlesResults: CheckerResult[];
  doublesResult: CheckerResult;
};

export default function CheckerClient({ tournament, singlesResults, doublesResult }: Props) {
  const [singlesRank, setSinglesRank] = useState('');
  const [combinedDoublesRank, setCombinedDoublesRank] = useState('');

  const ready = useMemo(() => {
    return Number(singlesRank) > 0 || Number(combinedDoublesRank) > 0;
  }, [singlesRank, combinedDoublesRank]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-lg font-semibold">{tournament.name}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {tournament.city}
          {tournament.country ? `, ${tournament.country}` : ''} · {tournament.level} · {tournament.surface}
        </p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-2">
        <label className="block">
          <div className="mb-2 text-sm text-neutral-300">Singles ranking</div>
          <input
            type="number"
            value={singlesRank}
            onChange={(e) => setSinglesRank(e.target.value)}
            className="w-full rounded-xl border border-neutral-700 bg-black px-3 py-2 text-white outline-none"
            placeholder="e.g. 178"
          />
        </label>

        <label className="block">
          <div className="mb-2 text-sm text-neutral-300">Combined doubles ranking</div>
          <input
            type="number"
            value={combinedDoublesRank}
            onChange={(e) => setCombinedDoublesRank(e.target.value)}
            className="w-full rounded-xl border border-neutral-700 bg-black px-3 py-2 text-white outline-none"
            placeholder="e.g. 242"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-dashed border-neutral-800 p-4 text-sm text-neutral-400">
        V1 rule locked: doubles checker uses the <span className="text-white">combined doubles ranking as direct input</span>. No partner lookup and no individual doubles ranking logic.
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-base font-semibold">Current result shape</h3>
        {!ready ? (
          <p className="mt-3 text-sm text-neutral-400">Enter a singles ranking and/or combined doubles ranking to use this page later once cutoff snapshots are loaded.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {singlesResults.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-neutral-800 px-3 py-2">
                <span>{item.label}</span>
                <span className="text-neutral-300">{item.status}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl border border-neutral-800 px-3 py-2">
              <span>{doublesResult.label}</span>
              <span className="text-neutral-300">{doublesResult.status}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
