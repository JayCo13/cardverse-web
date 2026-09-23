import { SITE_URL } from '@/lib/seo/site';

/** Existing marketplace sitemap plus the three stable catalog pilot partitions. */
export function GET() {
  const urls = [
    `${SITE_URL}/sitemap.xml`,
    ...[0, 1, 2].map((id) => `${SITE_URL}/catalog/sitemap/${id}.xml`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
