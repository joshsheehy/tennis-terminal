import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tennis Terminal',
  description: 'Tournament schedule and entry intel for pro tennis players.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
