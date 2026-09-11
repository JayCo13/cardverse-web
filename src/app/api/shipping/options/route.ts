import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CheckoutShippingError, listCheckoutShippingOptions } from '@/lib/verified-shipping';

/**
 * What each seller in a cart would charge to send their parcel here.
 *
 * The checkout page's preview, and the reason it can show a carrier picker at
 * all. It answers with the same function that bills the order, so the row a
 * buyer selects is the row they pay — the page does no fee arithmetic of its
 * own, and cannot drift away from the server by doing it differently.
 *
 * Card ids come from the browser; prices and fees do not. Everything that costs
 * money is read from the listings and the shop table.
 */

type SellerInput = { sellerId: string; cardIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as {
        toProvinceId?: unknown;
        toProvinceName?: unknown;
        sellers?: unknown;
    } | null;

    const toProvinceId = Number(body?.toProvinceId);
    const toProvinceName = typeof body?.toProvinceName === 'string' ? body.toProvinceName.trim() : '';
    if (!Number.isSafeInteger(toProvinceId) || toProvinceId <= 0 || !toProvinceName) {
        return NextResponse.json(
            { error: 'Thiếu địa chỉ nhận hàng.', code: 'shipping_address_invalid' },
            { status: 400 },
        );
    }

    if (!Array.isArray(body?.sellers) || body.sellers.length === 0 || body.sellers.length > 50) {
        return NextResponse.json({ error: 'Danh sách người bán không hợp lệ.' }, { status: 400 });
    }

    const sellers: SellerInput[] = [];
    for (const raw of body.sellers) {
        const entry = raw as { sellerId?: unknown; cardIds?: unknown };
        const sellerId = String(entry?.sellerId ?? '');
        if (!UUID.test(sellerId)) {
            return NextResponse.json({ error: 'Người bán không hợp lệ.' }, { status: 400 });
        }
        const cardIds = Array.isArray(entry.cardIds)
            ? entry.cardIds.map((id) => String(id)).filter((id) => UUID.test(id))
            : [];
        sellers.push({ sellerId, cardIds });
    }

    try {
        const options = await listCheckoutShippingOptions(
            sellers.map((seller) => ({ ...seller, toProvinceId, toProvinceName })),
        );
        return NextResponse.json({ data: Object.fromEntries(options) });
    } catch (error) {
        const known = error instanceof CheckoutShippingError;
        if (!known) console.error('Shipping options failed:', error);
        const code = known ? error.code : 'shipping_quote_failed';
        return NextResponse.json({
            error: 'Không tính được phí vận chuyển.',
            code,
            ...(known && error.sellerId ? { seller_id: error.sellerId, seller_name: error.sellerName || null } : {}),
        }, { status: code === 'shipping_quote_failed' ? 503 : 409 });
    }
}
