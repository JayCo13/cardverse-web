import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '@/lib/listing-description';

type ListingRow = {
    id: string;
    seller_id: string;
    status: string;
    listing_type: string;
    name: string;
    description: string | null;
    price: number | null;
    quantity: number | null;
    accept_offers: boolean | null;
    min_offer_percent: number | null;
    image_url: string | null;
    image_urls: string[] | null;
    category: string | null;
    condition: string | null;
    publisher: string | null;
    set_name: string | null;
    season: string | null;
    grading_company: string | null;
    grade: number | null;
    finish: string | null;
    card_number: string | null;
    language: string | null;
};

const getOwnListing = async (id: string) => {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Unauthorized', status: 401 } as const;

    const { data, error } = await supabase
        .from('cards')
        .select('id, seller_id, status, listing_type, name, description, price, quantity, accept_offers, min_offer_percent, image_url, image_urls, category, condition, publisher, set_name, season, grading_company, grade, finish, card_number, language')
        .eq('id', id)
        .single();

    if (error || !data) return { error: 'Listing not found', status: 404 } as const;
    const listing = data as ListingRow;
    if (listing.seller_id !== user.id) return { error: 'Forbidden', status: 403 } as const;

    const { data: openOffers, error: offerError } = await supabase
        .from('offers')
        .select('status')
        .eq('card_id', id)
        .in('status', ['pending', 'accepted', 'chosen']);

    if (offerError) return { error: 'Unable to check listing offers', status: 500 } as const;

    const openOfferRows = (openOffers || []) as Array<{ status: string }>;
    const openOfferCount = openOfferRows.length;
    const pendingOfferCount = openOfferRows.filter(offer => offer.status === 'pending').length;
    return { supabase, listing, hasOpenOffers: openOfferCount > 0, openOfferCount, pendingOfferCount } as const;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    const result = await getOwnListing(id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
        listing: result.listing,
        hasOpenOffers: result.hasOpenOffers,
        openOfferCount: result.openOfferCount,
        pendingOfferCount: result.pendingOfferCount,
    });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const startedAt = performance.now();
    const { id } = await context.params;
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const price = Number(body.price);
    const acceptOffers = body.acceptOffers;
    const minOfferPercent = Number(body.minOfferPercent ?? 0);

    if (name.length < 5 || name.length > 200) {
        return NextResponse.json({ error: 'Listing title must contain 5-200 characters' }, { status: 400 });
    }
    if (description.length > DESCRIPTION_MAX) {
        return NextResponse.json({ error: `Description must contain at most ${DESCRIPTION_MAX} characters` }, { status: 400 });
    }
    if (!Number.isSafeInteger(price) || price < 1000) {
        return NextResponse.json({ error: 'Price must be at least 1.000đ' }, { status: 400 });
    }
    if (typeof acceptOffers !== 'boolean') {
        return NextResponse.json({ error: 'acceptOffers must be a boolean' }, { status: 400 });
    }
    if (!Number.isInteger(minOfferPercent) || minOfferPercent < 0 || minOfferPercent > 100) {
        return NextResponse.json({ error: 'minOfferPercent must be between 0 and 100' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const dbStartedAt = performance.now();
    const { data, error } = await supabase.rpc('update_own_sale_listing' as never, {
        p_listing_id: id,
        p_name: name,
        p_description: description,
        p_price: price,
        p_accept_offers: acceptOffers,
        p_min_offer_percent: minOfferPercent,
    } as never);
    const dbDuration = performance.now() - dbStartedAt;
    if (dbDuration >= 2000) {
        console.warn('Slow listing update RPC', { dbDurationMs: Math.round(dbDuration) });
    }

    if (error) {
        const code = ['unauthorized', 'listing_not_found', 'listing_not_editable', 'open_offers_locked', 'invalid_listing_payload']
            .find(value => error.message.includes(value));
        const status = code === 'unauthorized' ? 401
            : code === 'listing_not_found' ? 404
                : code === 'listing_not_editable' || code === 'open_offers_locked' ? 409
                    : 400;
        const message = code === 'listing_not_editable' ? 'Only active sale listings can be edited'
            : code === 'open_offers_locked' ? 'Price and offer settings cannot be changed while an offer is open'
                : code === 'invalid_listing_payload'
                    ? `A changed description must contain ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters and all fields must be valid`
                    : error.message || 'Unable to update listing';
        const response = NextResponse.json(
            { error: message, code: code === 'open_offers_locked' ? 'OPEN_OFFERS_LOCKED' : code },
            { status },
        );
        response.headers.set('Server-Timing', `listing-db;dur=${dbDuration.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`);
        return response;
    }

    const response = NextResponse.json(data);
    response.headers.set('Server-Timing', `listing-db;dur=${dbDuration.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return response;
}
