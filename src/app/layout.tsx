import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import SiteNav from '@/components/SiteNav';
import AppTabBar from '@/components/AppTabBar';
import { APP_USER_AGENT_TOKEN } from '@/lib/nav';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from '@/lib/brand';

// Self-hosted at build time by next/font — no runtime request to Google.
// Variable weight + width: body text runs at normal width, headings use a
// slightly condensed cut (see h1–h3 in globals.css).
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
  variable: '--font-sans',
});

const TITLE = `${SITE_NAME} — Entry Cutoffs & Schedule for Pro Tennis`;

export const metadata: Metadata = {
  // Lets relative OG/Twitter image + canonical URLs resolve to the live domain.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'tennis entry cutoffs',
    'tennis cut ranking',
    'ATP Tour schedule',
    'Challenger Tour schedule',
    'ITF World Tennis Tour',
    'tournament entry list',
    'main draw cutoff',
    'qualifying cutoff',
    'tennis swing planner',
    'pro tennis schedule',
  ],
  category: 'sports',
  alternates: {
    canonical: '/',
  },
  // Standalone-mode presentation for "Add to Home Screen" on iOS Safari
  // (manifest.ts covers Android/Chrome's install prompt).
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    // og:image is supplied automatically by app/opengraph-image.tsx.
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SITE_DESCRIPTION,
    // twitter:image is supplied automatically by app/twitter-image.tsx.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export const viewport: Viewport = {
  // Extend under the home indicator on notched phones; safe-area env() insets
  // in the CSS keep interactive elements clear of it.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#151412' },
  ],
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  alternateName: 'TennisCuts',
  url: SITE_URL,
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={archivo.variable}>
      <head>
        {/* Runs before React hydrates to prevent a flash of the wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
        {/* Same timing for app mode: the iOS app tags its user agent, and .in-app
            swaps the top links for the bottom tab bar before anything paints. */}
        <script dangerouslySetInnerHTML={{ __html: `if(navigator.userAgent.indexOf(${JSON.stringify(APP_USER_AGENT_TOKEN)})!==-1)document.documentElement.classList.add('in-app');` }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        <ServiceWorkerRegister />
        <SiteNav />
        {children}
        <AppTabBar />
      </body>
    </html>
  );
}
