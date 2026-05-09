import Link from 'next/link';

const AVAILABLE_YEARS = [2026, 2025, 2024];

export default function YearPicker({ currentYear }: { currentYear: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
      {AVAILABLE_YEARS.map((year) => {
        const active = year === currentYear;
        return (
          <Link
            key={year}
            href={year === 2026 ? '/' : `/?year=${year}`}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: active ? '2px solid #0f172a' : '1px solid #d1d5db',
              background: active ? '#0f172a' : '#ffffff',
              color: active ? '#ffffff' : '#374151',
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
