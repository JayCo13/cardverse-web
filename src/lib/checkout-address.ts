import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * The delivery address an order is priced and booked against — read, never
 * received.
 *
 * Checkout used to take the recipient's name, the address text and GoShip's
 * city/district/ward ids straight from the request body. Since the price is
 * GoShip's answer for the district, a body could name a cheap nearby district
 * in the ids and a distant one in the text: the buyer would be undercharged and
 * the waybill would route where the ids said, not where the text did. So the
 * body now carries only `address_id`, and everything about the address — the
 * text on the label and the ids the parcel is priced and booked on — comes
 * from the caller's own row in `shipping_addresses`, so the two cannot
 * disagree.
 */

export type CheckoutAddress = {
    id: string;
    to_name: string;
    to_phone: string;
    to_province_id: number | null;
    to_province_name: string | null;
    to_district_id: number | null;
    to_district_name: string | null;
    to_ward_code: string | null;
    to_ward_name: string | null;
    to_address_detail: string;
    shipping_address: string;
    goship: { city: string; district: string; ward: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOSHIP_ID = /^[0-9]{1,12}$/;

export class CheckoutAddressError extends Error {
    constructor(public readonly code: 'address_required' | 'address_not_found' | 'shipping_address_invalid' | 'address_read_failed') {
        super(code);
        this.name = 'CheckoutAddressError';
    }
}

/**
 * Load one of the caller's saved addresses for an order.
 *
 * Refuses a row without GoShip ids (saved before the book moved to that
 * geography) — nothing can be priced or booked against it, and the book itself
 * asks the buyer to re-pick it before selecting it.
 */
export async function loadCheckoutAddress(userId: string, addressId: unknown): Promise<CheckoutAddress> {
    const id = typeof addressId === 'string' ? addressId.trim() : '';
    if (!UUID.test(id)) throw new CheckoutAddressError('address_required');

    const service = createServiceSupabaseClient();
    const { data, error } = await service
        .from('shipping_addresses')
        .select('id, recipient_name, phone, province_id, province_name, district_id, district_name, ward_code, ward_name, detail, goship')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw new CheckoutAddressError('address_read_failed');
    const row = data as {
        id: string; recipient_name: string | null; phone: string | null;
        province_id: number | null; province_name: string | null; district_id: number | null; district_name: string | null;
        ward_code: string | null; ward_name: string | null; detail: string | null;
        goship: { city?: unknown; district?: unknown; ward?: unknown } | null;
    } | null;
    if (!row) throw new CheckoutAddressError('address_not_found');

    const city = String(row.goship?.city ?? '').trim();
    const district = String(row.goship?.district ?? '').trim();
    const ward = String(row.goship?.ward ?? '').trim();
    if (!GOSHIP_ID.test(city) || !GOSHIP_ID.test(district) || !GOSHIP_ID.test(ward)
        || !row.recipient_name?.trim() || !row.phone?.trim() || !row.detail?.trim()) {
        throw new CheckoutAddressError('shipping_address_invalid');
    }

    return {
        id: row.id,
        to_name: row.recipient_name.trim(),
        to_phone: row.phone.trim(),
        to_province_id: row.province_id,
        to_province_name: row.province_name,
        to_district_id: row.district_id,
        to_district_name: row.district_name,
        to_ward_code: row.ward_code,
        to_ward_name: row.ward_name,
        to_address_detail: row.detail.trim(),
        // Filtered, not interpolated: the district is null on every row saved
        // since that tier was abolished, and a template leaves ", ,".
        shipping_address: [row.detail, row.ward_name, row.district_name, row.province_name].filter(Boolean).join(', '),
        goship: { city, district, ward },
    };
}

export const checkoutAddressStatus = (code: CheckoutAddressError['code']) =>
    code === 'address_read_failed' ? 503 : code === 'address_not_found' ? 404 : 400;
