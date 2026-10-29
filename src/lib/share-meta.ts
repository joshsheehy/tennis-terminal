import type { Metadata } from 'next';
import { SITE_NAME } from './brand';

// Link-preview metadata (iMessage, WhatsApp, Slack, X…) for one page.
// Next doesn't merge openGraph/twitter objects with the layout's — a page
// that sets them replaces the whole object — so every page that wants its own
// preview needs the full set here, image included. Without it, previews fell
// back to the homepage's title and URL.
export function shareMetadata({
  title,
  description,
  path,
  image = '/opengraph-image',
  imageAlt = `${SITE_NAME} — entry cutoffs, schedules & swing planner for the pro tennis tour`,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: path,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
