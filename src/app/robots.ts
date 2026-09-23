import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site';

/**
 * Everything a signed-out visitor can read is crawlable. The account, money
 * and checkout surfaces are kept out, as are the routes the middleware still
 * redirects to the "coming soon" toast — a crawler following them would only
 * record a chain of redirects to the home page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/account',
          '/wallet',
          '/orders',
          '/checkout',
          '/cart',
          '/offers',
          '/transaction',
          '/profile',
          '/collection',
          '/sell/edit/',
          '/auth/',
          '/reset-password',
          '/update-password',
          '/bid',
          '/razz',
          '/forum',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap-index.xml`,
    host: SITE_URL,
  };
}
