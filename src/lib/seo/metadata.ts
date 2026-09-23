import type { Metadata } from 'next';
import { OG_IMAGE, SITE_DESCRIPTION_VI, SITE_NAME, SITE_TITLE, SITE_URL, absoluteUrl } from './site';

type PageMetadataInput = {
  /** Page name only; the site name is appended. Omit for the home page. */
  title?: string;
  description?: string;
  /** Route path, e.g. `/pokemon` — becomes the canonical URL. */
  path: string;
  /** Absolute or site-relative image. Defaults to the square logo. */
  image?: string;
  imageAlt?: string;
  /** Pages that exist but should stay out of the index (private, expired, hidden). */
  noIndex?: boolean;
  type?: 'website' | 'article';
};

/**
 * One metadata shape for every route, so each page has its own title,
 * description and canonical URL and shares the same Open Graph card layout.
 * Before this, every page repeated the root layout's title and Google's
 * sitelinks had nothing to choose from but "Terms of Service".
 */
export function buildMetadata({
  title,
  description = SITE_DESCRIPTION_VI,
  path,
  image = OG_IMAGE,
  imageAlt = `${SITE_NAME} logo`,
  noIndex = false,
  type = 'website',
}: PageMetadataInput): Metadata {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_TITLE;
  const url = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  const isLogo = image === OG_IMAGE;

  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description,
    alternates: { canonical: url },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description,
      type,
      url,
      siteName: SITE_NAME,
      locale: 'vi_VN',
      images: [isLogo
        ? { url: imageUrl, width: 1024, height: 1024, alt: imageAlt }
        : { url: imageUrl, alt: imageAlt }],
    },
    twitter: {
      card: isLogo ? 'summary' : 'summary_large_image',
      title: fullTitle,
      description,
      images: [imageUrl],
    },
  };
}
