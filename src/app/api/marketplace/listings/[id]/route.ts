import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '@/lib/listing-description';
import { isNonCard, PRODUCT_CONDITIONS, validProductDetails, flexibleProductsEnabled, productCopy } from '@/lib/product-listing';
import { getRequestLocale } from '@/lib/request-localization';

type ListingRow = {
    product_kind?: string;
    product_type_label?: string;
    product_details?: Record<string, string>;
    shipping_fee?: number;
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
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) return { error: 'Listing not found', status: 404 } as const;
    const listing = data as ListingRow;
    if (listing.seller_id !== user.id) return { error: 'Forbidden', status: 403 } as const;

    const { data: openOffers, error: offerError } = await supabase
        .from('offers')
        .select('status')
        .eq('card_id', id)
        .in('status', ['pending', 'accepted', 'chosen', 'on_hold']);

    if (offerError) return { error: 'Unable to check listing offers', status: 500 } as const;

    const openOfferRows = (openOffers || []) as Array<{ status: string }>;
    const openOfferCount = openOfferRows.length;
    const pendingOfferCount = openOfferRows.filter(offer => offer.status === 'pending').length;
    return { supabase, listing, hasOpenOffers: openOfferCount > 0, openOfferCount, pendingOfferCount } as const;
};

async function handleGET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const startedAt = performance.now();
    const { id } = await context.params;
    const body = await request.json();
    const own = await getOwnListing(id);
    if ('error' in own) return NextResponse.json({ error: own.error }, { status: own.status });
    const nonCard = isNonCard(own.listing.product_kind);
    if (nonCard && (!flexibleProductsEnabled || !PRODUCT_CONDITIONS.includes(body.condition)
        || !validProductDetails(body.product_details) || !Number.isSafeInteger(body.shipping_fee) || body.shipping_fee < 0 || body.shipping_fee > 99999
        || (own.listing.product_kind === 'other' && (typeof body.product_type_label !== 'string' || body.product_type_label.trim().length < 2 || body.product_type_label.trim().length > 80)))) {
        return NextResponse.json({ error: productCopy(getRequestLocale(request)).invalid }, { status: 400 });
    }
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
    const legacyArgs = {
        p_listing_id: id,
        p_name: name,
        p_description: description,
        p_price: price,
        p_accept_offers: acceptOffers,
        p_min_offer_percent: minOfferPercent,
    };
    const { data, error } = await supabase.rpc((nonCard ? 'update_own_product_listing' : 'update_own_sale_listing') as never,
        (nonCard ? { p_listing_id: id, p_data: {
            name, description, price, acceptOffers, minOfferPercent,
            condition: body.condition, product_type_label: body.product_type_label,
            product_details: body.product_details, shipping_fee: body.shipping_fee,
        } } : legacyArgs) as never);
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

export const GET = accountRoute(handleGET);
export const PATCH = accountRoute(handlePATCH);
