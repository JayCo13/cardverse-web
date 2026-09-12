import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CheckoutShippingError, listCheckoutShippingOptionsSettled } from '@/lib/verified-shipping';

/**
 * What each seller's parcel costs to send to this GoShip district, per carrier.
 *
 * The grid, the listing page, the cart and both checkouts all read this, and
 * it answers with the same function that bills the order, so the row a buyer
 * picks is the row they pay. Card ids come from the browser; everything that
 * costs money is read server-side and priced by GoShip.
 *
 * `to` is GoShip's own city/district ids, taken from the buyer's saved address
 * (shipping_addresses.goship). Never the 2025 province structure — GoShip
 * routes on the older one.
 */

type SellerInput = { sellerId: string; cardIds: string[]; key?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOSHIP_ID = /^[0-9]{1,12}$/;

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as {
        to?: { city?: unknown; district?: unknown };
        sellers?: unknown;
    } | null;

    const city = String(body?.to?.city ?? '').trim();
    const district = String(body?.to?.district ?? '').trim();
    if (!GOSHIP_ID.test(city) || !GOSHIP_ID.test(district)) {
        return NextResponse.json({ error: 'Thiếu địa chỉ nhận hàng.', code: 'shipping_address_invalid' }, { status: 400 });
    }

    if (!Array.isArray(body?.sellers) || body.sellers.length === 0 || body.sellers.length > 50) {
        return NextResponse.json({ error: 'Danh sách người bán không hợp lệ.' }, { status: 400 });
    }

    const sellers: SellerInput[] = [];
    for (const raw of body.sellers) {
        const entry = raw as { sellerId?: unknown; cardIds?: unknown; key?: unknown };
        const sellerId = String(entry?.sellerId ?? '');
        if (!UUID.test(sellerId)) return NextResponse.json({ error: 'Người bán không hợp lệ.' }, { status: 400 });
        const cardIds = Array.isArray(entry.cardIds) ? entry.cardIds.map((id) => String(id)).filter((id) => UUID.test(id)) : [];
        // An optional handle for the answer, so one shop can be asked about
        // several listings in one request. Bounded, and never interpreted.
        const key = typeof entry.key === 'string' && entry.key.length <= 200 ? entry.key : undefined;
        sellers.push({ sellerId, cardIds, ...(key ? { key } : {}) });
    }

    // A grid asks for a dozen shops at once, and one shop that cannot be
    // quoted must not blank the other eleven: per-seller failures come back
    // as an `errors` map, and only a bad request or a total outage is a
    // non-200.
    let data: Record<string, unknown>;
    let errors: Record<string, { code: string; seller_name: string | null }>;
    try {
        ({ data, errors } = await listCheckoutShippingOptionsSettled(sellers.map((seller) => ({ ...seller, to: { city, district } }))));
    } catch (error) {
        const known = error instanceof CheckoutShippingError;
        if (!known) console.error('Shipping options failed:', error);
        const code = known ? error.code : 'shipping_quote_failed';
        return NextResponse.json({ error: 'Không tính được phí vận chuyển.', code }, { status: code === 'shipping_quote_failed' ? 503 : 400 });
    }

    if (Object.keys(data).length === 0) {
        const first = Object.values(errors)[0];
        const code = first?.code ?? 'shipping_quote_failed';
        return NextResponse.json({
            error: 'Không tính được phí vận chuyển.',
            code,
            ...(Object.keys(errors).length === 1 ? { seller_id: Object.keys(errors)[0], seller_name: first?.seller_name ?? null } : {}),
            errors,
        }, { status: code === 'shipping_quote_failed' ? 503 : 409 });
    }
    return NextResponse.json({ data, errors });
}
