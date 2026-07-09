import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// Single order for its buyer or seller (used by the order details page).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            card:cards(id, name, image_url, category, condition, is_bundle),
            buyer:profiles!orders_buyer_id_fkey(id, display_name, email, profile_image_url),
            seller:profiles!orders_seller_id_fkey(id, display_name, email, profile_image_url, seller_verified, seller_rating, seller_review_count)
        `)
        .eq('id', id)
        .single();

    if (error || !data) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = data as any;
    if (order.buyer_id !== user.id && order.seller_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ order, viewerRole: order.buyer_id === user.id ? 'buyer' : 'seller' });
}
