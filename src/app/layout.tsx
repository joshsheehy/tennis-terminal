import type { Metadata } from 'next';
import './globals.css';
import SiteNav from '@/components/SiteNav';

export const metadata: Metadata = {
  title: 'Tennis Cuts',
  description: 'Tournament schedule and entry intel for pro tennis players.',
  openGraph: {
    title: 'Tennis Cuts',
    siteName: 'Tennis Cuts',
    description: 'Tournament schedule and entry intel for pro tennis players.',
    url: 'https://tenniscuts.com',
  },
  twitter: {
    card: 'summary',
    title: 'Tennis Cuts',
    description: 'Tournament schedule and entry intel for pro tennis players.',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before React hydrates to prevent a flash of the wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
      </head>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
