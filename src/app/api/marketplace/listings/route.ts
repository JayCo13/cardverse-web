import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const MIN_MARKETPLACE_PRICE_VND = 1000;

export async function POST(request: NextRequest) {
    try {
        const authClient = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: verification, error: verificationError } = await authClient
            .from('seller_verifications')
            .select('status')
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .single();

        if (verificationError || !verification) {
            return NextResponse.json({ error: 'Seller verification required' }, { status: 403 });
        }

        // A pickup address is required before listing so shipping fees can be
        // calculated for buyers. Enforced here (not just in the UI) so it can't
        // be bypassed by calling the API directly.
        const { data: profile } = await authClient
            .from('profiles')
            .select('address_district_id, address_ward_code')
            .eq('id', user.id)
            .single();
        const sellerProfile = profile as { address_district_id: number | null; address_ward_code: string | null } | null;
        if (!sellerProfile?.address_district_id || !sellerProfile?.address_ward_code) {
            return NextResponse.json({
                error: 'Vui lòng thiết lập địa chỉ lấy hàng trước khi đăng bán.',
                code: 'MISSING_SELLER_ADDRESS',
            }, { status: 400 });
        }

        const body = await request.json();
        if (body.listing_type === 'sale' && Number(body.price) < MIN_MARKETPLACE_PRICE_VND) {
            return NextResponse.json({ error: `Giá bán tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
        }
        if (body.listing_type === 'auction' && Number(body.starting_bid) < MIN_MARKETPLACE_PRICE_VND) {
            return NextResponse.json({ error: `Giá khởi điểm tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
        }
        if (body.listing_type === 'razz' && Number(body.ticket_price) < MIN_MARKETPLACE_PRICE_VND) {
            return NextResponse.json({ error: `Giá vé tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
        }

        const cardData = {
            ...body,
            seller_id: user.id,
        };

        const { data: card, error: insertError } = await authClient
            .from('cards')
            .insert(cardData as never)
            .select('id')
            .single() as { data: { id: string } | null; error: { message?: string } | null };

        if (insertError || !card) {
            return NextResponse.json({ error: insertError?.message || 'Failed to create listing' }, { status: 400 });
        }

        return NextResponse.json({ success: true, cardId: card.id });
    } catch (error: any) {
        console.error('Create listing error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
