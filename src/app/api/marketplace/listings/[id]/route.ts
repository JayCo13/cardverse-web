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
    image_url: string | null;
};

const getOwnListing = async (id: string) => {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Unauthorized', status: 401 } as const;

    const { data, error } = await supabase
        .from('cards')
        .select('id, seller_id, status, listing_type, name, description, price, quantity, accept_offers, image_url')
        .eq('id', id)
        .single();

    if (error || !data) return { error: 'Listing not found', status: 404 } as const;
    const listing = data as ListingRow;
    if (listing.seller_id !== user.id) return { error: 'Forbidden', status: 403 } as const;

    return { supabase, listing } as const;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    const result = await getOwnListing(id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ listing: result.listing });
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
    const quantity = Number(body.quantity);
    const acceptOffers = body.acceptOffers;

    if (name.length < 5 || name.length > 200) {
        return NextResponse.json({ error: 'Listing title must contain 5-200 characters' }, { status: 400 });
    }
    if (description.length < 300 || description.length > 5000) {
        return NextResponse.json({ error: 'Description must contain 300-5000 characters' }, { status: 400 });
    }
    if (!Number.isSafeInteger(price) || price < 1000) {
        return NextResponse.json({ error: 'Price must be at least 1.000đ' }, { status: 400 });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
        return NextResponse.json({ error: 'Quantity must be between 1 and 100' }, { status: 400 });
    }
    if (typeof acceptOffers !== 'boolean') {
        return NextResponse.json({ error: 'acceptOffers must be a boolean' }, { status: 400 });
    }

    const { data, error } = await result.supabase
        .from('cards')
        .update({
            name,
            description,
            price,
            quantity,
            accept_offers: acceptOffers,
            updated_at: new Date().toISOString(),
        } as never)
        .eq('id', id)
        .eq('seller_id', result.listing.seller_id)
        .eq('status', 'active')
        .eq('listing_type', 'sale')
        .select('id, name, description, price, quantity, accept_offers')
        .single();

    if (error || !data) {
        return NextResponse.json({ error: error?.message || 'Unable to update listing' }, { status: 400 });
    }

    return NextResponse.json({ listing: data });
}
