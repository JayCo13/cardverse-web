import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Card } from '@/lib/types';
import BuyClient from './buy-client';
import { mapSaleCard } from './map-sale-card';

/**
 * The marketplace listing, fetched before the HTML leaves the server.
 *
 * It used to arrive in three stages: download the HTML, download and run the
 * JavaScript, and only then ask Supabase for the listings. That last step is a
 * round trip from the visitor's browser — 113ms of network each way before the
 * database has done any of its 12ms of work — and it could not start until the
 * first two finished.
 *
 * Fetched here it costs one round trip from a machine that is already talking
 * to the database, and the listings are in the markup the browser receives.
 * Everything interactive — filters, sort, cart, offers — stays in the client
 * component; only the first read moves.
 */
export const dynamic = 'force-dynamic';

export default async function BuyPage() {
    let initialCards: Card[] = [];
    let initialLoadSucceeded = false;

    try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
            .from('cards')
            .select('*, profiles:seller_id(display_name, profile_image_url, seller_verified, seller_rating, seller_review_count, shipping_carriers, shipping_fees)')
            .eq('listing_type', 'sale')
            .eq('status', 'active');

        if (data && !error) {
            initialCards = data.map(mapSaleCard);
            initialLoadSucceeded = true;
        }
    } catch (error) {
        // A failure here costs the head start, not the page: the client runs
        // the same query on mount and will fill the list in as it always did.
        console.error('[Buy] Server-side listing fetch failed:', error);
    }

    return <BuyClient initialCards={initialCards} initialLoadSucceeded={initialLoadSucceeded} />;
}
