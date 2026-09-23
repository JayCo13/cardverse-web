import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/seo/site';

/**
 * Public routes plus every listing and seller a crawler may show. Listings
 * that are hidden, deleted, sold or expired are left out rather than marked:
 * the card page answers those with `noindex`, and a sitemap that lists them
 * only invites the crawl.
 */
// Read through the request-scoped client (it needs cookies), so the sitemap
// is built per request rather than at build time — where the query cannot run.
export const dynamic = 'force-dynamic';

const STATIC_ROUTES: { path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/buy', priority: 0.9, changeFrequency: 'daily' },
  { path: '/pokemon', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/onepiece', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/soccer', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/sold', priority: 0.5, changeFrequency: 'daily' },
  { path: '/pricing', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/help', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/complaints', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'monthly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    priority: route.priority,
    changeFrequency: route.changeFrequency,
  }));

  try {
    const supabase = await createServerSupabaseClient();
    type Row = { id: string; updated_at: string | null };
    type CardRow = Row & { seller_id: string | null };
    type SellerRow = Row & { display_name: string | null };
    const [cards, sellers] = await Promise.all([
      supabase
        .from('cards')
        .select('id, updated_at, seller_id')
        .eq('status', 'active')
        .eq('listing_visibility', 'visible')
        .order('updated_at', { ascending: false })
        .limit(5000)
        .returns<CardRow[]>(),
      supabase
        .from('profiles')
        .select('id, updated_at, display_name')
        .eq('seller_verified', true)
        .limit(1000)
        .returns<SellerRow[]>(),
    ]);

    if (cards.error) throw cards.error;
    if (sellers.error) throw sellers.error;

    const sellersWithPublicListings = new Set<string>();
    for (const card of cards.data ?? []) {
      if (card.seller_id) sellersWithPublicListings.add(card.seller_id);
      entries.push({
        url: `${SITE_URL}/cards/${card.id}`,
        lastModified: card.updated_at ? new Date(card.updated_at) : undefined,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
    for (const seller of sellers.data ?? []) {
      if (!seller.display_name?.trim() || !sellersWithPublicListings.has(seller.id)) continue;
      entries.push({
        url: `${SITE_URL}/users/${seller.id}`,
        lastModified: seller.updated_at ? new Date(seller.updated_at) : undefined,
        changeFrequency: 'weekly',
        priority: 0.4,
      });
    }
  } catch (error) {
    console.error('[sitemap] listing query failed', error);
    throw error;
  }

  return entries;
}
