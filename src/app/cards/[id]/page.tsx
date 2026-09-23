import type { Metadata } from 'next';
import { cache } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildMetadata } from '@/lib/seo/metadata';
import { JsonLd, breadcrumbJsonLd, productJsonLd } from '@/lib/seo/jsonld';
import type { Card } from '@/lib/types';
import CardDetailClient from './card-detail-client';
import { mapCard } from './map-card';
import { getCategoryCode } from '@/lib/category-code';

/**
 * The listing is fetched before the HTML leaves the server, for two readers:
 * the crawler, which never runs the client's `useEffect` and used to receive a
 * page with no card name, price or image on it; and the visitor, who now sees
 * the listing instead of a skeleton. Everything interactive stays in
 * `card-detail-client.tsx`.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loaded = { card: Card; visibility: string | null };

/** Deduplicated between `generateMetadata` and the page for one request. */
const loadCard = cache(async (id: string): Promise<Loaded | null> => {
    if (!UUID.test(id)) return null;
    try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
            .from('cards')
            .select('*, profiles:seller_id(display_name, profile_image_url, seller_verified, seller_review_count)')
            .eq('id', id)
            .maybeSingle();
        if (error || !data) return null;
        const row = data as { listing_visibility?: string | null };
        return { card: mapCard(data), visibility: row.listing_visibility ?? null };
    } catch {
        // The client fetches again and shows its own error state.
        return null;
    }
});

/** The category landing page a listing belongs under, for the breadcrumb. */
const CATEGORY_PATHS: Record<string, string> = { POK: '/pokemon', OP: '/onepiece', SOC: '/soccer' };
function categoryPath(category: string): string {
    return CATEGORY_PATHS[getCategoryCode(category)] ?? '/buy';
}

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

/** Only a live, public sale listing is worth indexing; the rest still render. */
function isIndexable(loaded: Loaded): boolean {
    return loaded.visibility === 'visible' && loaded.card.status === 'active';
}

function describe(card: Card): string {
    const parts = [card.category, card.setName, card.condition].filter(Boolean).join(' · ');
    const price = card.listingType === 'sale' && card.price ? ` Giá ${vnd.format(card.price)}.` : '';
    const seller = card.sellerName ? ` Người bán: ${card.sellerName}.` : '';
    const own = card.description?.trim();
    const lead = own ? own.slice(0, 140).replace(/\s+\S*$/, '') + (own.length > 140 ? '…' : '') : `${card.name} — ${parts}.`;
    return `${lead}${price}${seller} Mua an toàn với thanh toán ký quỹ trên CardVerseHub.`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const loaded = await loadCard(id);
    if (!loaded || loaded.visibility !== 'visible') {
        return buildMetadata({ title: 'Không tìm thấy thẻ', path: `/cards/${id}`, noIndex: true });
    }
    const { card } = loaded;
    const price = card.listingType === 'sale' && card.price ? ` – ${vnd.format(card.price)}` : '';
    return buildMetadata({
        title: `${card.name}${price}`,
        description: describe(card),
        path: `/cards/${card.id}`,
        image: card.imageUrl || card.imageUrls?.[0] || undefined,
        imageAlt: card.name,
        noIndex: !isIndexable(loaded),
    });
}

export default async function CardDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const loaded = await loadCard(id);
    // Hidden listings are readable through the legacy cards RLS policy. Keep
    // their details out of the server HTML; the client still checks ownership
    // and lets the seller view their own listing after hydration.
    const card = loaded?.visibility === 'visible' ? loaded.card : null;

    return (
        <>
            {card && loaded && isIndexable(loaded) && (
                <JsonLd data={[
                    productJsonLd(card),
                    breadcrumbJsonLd([
                        { name: 'Trang chủ', path: '/' },
                        { name: 'Mua thẻ', path: '/buy' },
                        { name: card.category, path: categoryPath(card.category) },
                        { name: card.name, path: `/cards/${card.id}` },
                    ]),
                ]} />
            )}
            <CardDetailClient initialCard={card} />
        </>
    );
}
