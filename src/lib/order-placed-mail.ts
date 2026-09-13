import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOrderPlacedToBuyer, sendOrderPlacedToSeller } from '@/lib/mail';
import { getCarrier } from '@/lib/shipping-carriers';

/**
 * The "you paid" / "you sold" mails, for orders that are already committed.
 *
 * Reads everything from the rows rather than from whatever the caller had in
 * hand, so a checkout of five listings from three shops and a single buy-now
 * send the same mail with the same figures. /api/marketplace/buy still builds
 * its own from local state; the PayOS webhook has the rows too. This is for
 * /api/checkout, which had the bell and the chat receipt but no mail at all —
 * the seller found the order on the site or not at all.
 *
 * Swallows every failure. The orders are paid; a mail server being down is
 * not a reason to answer the buyer with an error.
 */

type OrderRow = {
    id: string;
    card_id: string | null;
    seller_id: string;
    buyer_id: string;
    amount: number | null;
    shipping_fee: number | null;
    total_paid: number | null;
    platform_fee: number | null;
    shipping_carrier: string | null;
    to_address_detail: string | null;
    to_ward_name: string | null;
    to_district_name: string | null;
    to_province_name: string | null;
};

type Profile = { id: string; email: string | null; display_name: string | null };

export async function sendOrderPlacedMails(service: SupabaseClient<any, any, any>, orderIds: string[]): Promise<void> {
    const ids = [...new Set(orderIds.filter(Boolean))];
    if (ids.length === 0) return;
    try {
        const { data: orders, error } = await service
            .from('orders')
            .select('id, card_id, seller_id, buyer_id, amount, shipping_fee, total_paid, platform_fee, shipping_carrier, to_address_detail, to_ward_name, to_district_name, to_province_name')
            .in('id', ids)
            .returns<OrderRow[]>();
        if (error || !orders?.length) {
            if (error) console.error('[Mail] Order placed: could not read orders:', error.message);
            return;
        }

        const cardIds = [...new Set(orders.map((o) => o.card_id).filter((id): id is string => !!id))];
        const userIds = [...new Set(orders.flatMap((o) => [o.seller_id, o.buyer_id]))];
        const [{ data: cards }, { data: profiles }] = await Promise.all([
            cardIds.length
                ? service.from('cards').select('id, name').in('id', cardIds).returns<{ id: string; name: string | null }[]>()
                : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
            service.from('profiles').select('id, email, display_name').in('id', userIds).returns<Profile[]>(),
        ]);
        const cardName = new Map((cards ?? []).map((c) => [c.id, c.name || 'Thẻ']));
        const profile = new Map((profiles ?? []).map((p) => [p.id, p]));

        await Promise.allSettled(orders.flatMap((order) => {
            const buyer = profile.get(order.buyer_id);
            const seller = profile.get(order.seller_id);
            const name = (order.card_id && cardName.get(order.card_id)) || 'Thẻ';
            const amount = order.amount ?? 0;
            const shippingFee = order.shipping_fee ?? 0;
            const destination = [order.to_address_detail, order.to_ward_name, order.to_district_name, order.to_province_name]
                .filter(Boolean)
                .join(', ');
            return [
                sendOrderPlacedToBuyer(buyer?.email || '', {
                    orderId: order.id,
                    cardName: name,
                    amount,
                    shippingFee,
                    totalPaid: order.total_paid ?? amount + shippingFee,
                    carrierName: order.shipping_carrier ? (getCarrier(order.shipping_carrier)?.name ?? order.shipping_carrier) : null,
                    shippingAddress: destination || null,
                }),
                sendOrderPlacedToSeller(seller?.email || '', {
                    orderId: order.id,
                    cardName: name,
                    amount,
                    platformFee: typeof order.platform_fee === 'number' ? order.platform_fee : null,
                    buyerName: buyer?.display_name || null,
                    shippingAddress: destination || null,
                }),
            ];
        }));
    } catch (error) {
        console.error('[Mail] Order placed mails failed:', error);
    }
}
