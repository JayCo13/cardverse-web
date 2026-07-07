import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

    const { count: openOfferCount, error: offerError } = await supabase
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', id)
        .in('status', ['pending', 'accepted', 'chosen']);

    if (offerError) return { error: 'Unable to check listing offers', status: 500 } as const;

    return { supabase, listing, hasOpenOffers: (openOfferCount || 0) > 0 } as const;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    const result = await getOwnListing(id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ listing: result.listing, hasOpenOffers: result.hasOpenOffers });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    const result = await getOwnListing(id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    if (result.listing.status !== 'active' || result.listing.listing_type !== 'sale') {
        return NextResponse.json({ error: 'Only active sale listings can be edited' }, { status: 409 });
    }

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const price = Number(body.price);
    const acceptOffers = body.acceptOffers;
    const minOfferPercent = Number(body.minOfferPercent ?? 0);
    const originalDescription = (result.listing.description || '').trim();
    const descriptionChanged = description !== originalDescription;

    if (name.length < 5 || name.length > 200) {
        return NextResponse.json({ error: 'Listing title must contain 5-200 characters' }, { status: 400 });
    }
    // Grandfather legacy listings with short descriptions. They may update
    // other safe fields, but once the description itself changes it must meet
    // the current create-listing rule.
    if (description.length > 5000 || (descriptionChanged && description.length < 300)) {
        return NextResponse.json({ error: 'A changed description must contain 300-5000 characters' }, { status: 400 });
    }
    if (!Number.isSafeInteger(price) || price < 1000) {
        return NextResponse.json({ error: 'Price must be at least 1.000đ' }, { status: 400 });
    }
    if (typeof acceptOffers !== 'boolean') {
        return NextResponse.json({ error: 'acceptOffers must be a boolean' }, { status: 400 });
    }
    if (!Number.isFinite(minOfferPercent) || minOfferPercent < 0 || minOfferPercent > 100) {
        return NextResponse.json({ error: 'minOfferPercent must be between 0 and 100' }, { status: 400 });
    }

    const commercialTermsChanged =
        price !== Number(result.listing.price || 0) ||
        acceptOffers !== !!result.listing.accept_offers ||
        (acceptOffers ? minOfferPercent : 0) !== Number(result.listing.min_offer_percent || 0);

    if (result.hasOpenOffers && commercialTermsChanged) {
        return NextResponse.json(
            { error: 'Price and offer settings cannot be changed while an offer is open', code: 'OPEN_OFFERS_LOCKED' },
            { status: 409 },
        );
    }

    const { data, error } = await result.supabase
        .from('cards')
        .update({
            name,
            description,
            price,
            accept_offers: acceptOffers,
            min_offer_percent: acceptOffers ? minOfferPercent : 0,
            updated_at: new Date().toISOString(),
        } as never)
        .eq('id', id)
        .eq('seller_id', result.listing.seller_id)
        .eq('status', 'active')
        .eq('listing_type', 'sale')
        .select('id, name, description, price, quantity, accept_offers, min_offer_percent')
        .single();

    if (error || !data) {
        return NextResponse.json({ error: error?.message || 'Unable to update listing' }, { status: 400 });
    }

    return NextResponse.json({ listing: data });
}
