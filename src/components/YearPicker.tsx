import Link from 'next/link';
import { AVAILABLE_SEASONS } from '@/lib/seasons';

export default function YearPicker({ currentYear }: { currentYear: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
      {AVAILABLE_SEASONS.map((year) => {
        const active = year === currentYear;
        return (
          <Link
            key={year}
            href={`/cuts?year=${year}`}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: active ? '2px solid var(--text-strong)' : '1px solid var(--border-tag)',
              background: active ? 'var(--text-strong)' : 'var(--surface)',
              color: active ? 'var(--bg)' : 'var(--text-secondary)',
              fontWeight: active ? 700 : 400,
              fontSize: 15,
              textDecoration: 'none',
              display: 'inline-block',
              lineHeight: 1.4,
            }}
          >
            {year}
          </Link>
        );
      })}
    </div>
  );
}
