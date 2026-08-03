import type { SupabaseClient } from '@supabase/supabase-js';

// Auto-cancel PAID orders whose seller never uploaded tracking within the
// deadline. Self-contained (relists the card here, refunds the buyer, best-effort
// seller fault) so it works whether or not the relist DB trigger is applied.
// Safe to call opportunistically (indexed query, tiny working set) and from a
// scheduled cron. Idempotent per order via a CAS on status.
export async function expireUnshippedPaidOrders(service: SupabaseClient): Promise<number> {
    const nowIso = new Date().toISOString();

    const { data: due, error } = await service
        .from('orders')
        .select('id, buyer_id, seller_id, card_id, total_paid, metadata')
        .eq('status', 'paid')
        .lt('ship_deadline', nowIso)
        .limit(100);

    if (error || !due?.length) return 0;

    let cancelled = 0;
    for (const order of due as any[]) {
        // CAS: only the request that flips paid → cancelled acts.
        const { data: claimed } = await service
            .from('orders')
            .update({ status: 'cancelled', updated_at: nowIso } as never)
            .eq('id', order.id)
            .eq('status', 'paid')
            .select('id')
            .maybeSingle();
        if (!claimed) continue;

        try {
            // 1) Relist the card FIRST so it never gets stuck off-market, even if
            //    the refund below fails. Bundle → add the bought cards back.
            const selection = Array.isArray(order.metadata?.bundle_selection) ? order.metadata.bundle_selection : [];
            if (selection.length > 0) {
                const { data: cardRow } = await service.from('cards').select('bundle_items').eq('id', order.card_id).single();
                const items = Array.isArray((cardRow as any)?.bundle_items) ? (cardRow as any).bundle_items : [];
                await service.from('cards')
                    .update({ bundle_items: [...items, ...selection] as never, status: 'active', reserved_until: null, updated_at: nowIso } as never)
                    .eq('id', order.card_id);
            } else {
                await service.from('cards')
                    .update({ status: 'active', reserved_until: null, updated_at: nowIso } as never)
                    .eq('id', order.card_id)
                    .in('status', ['sold', 'in_transaction']);
            }

            // 2) Refund the buyer's wallet (atomic RPC).
            const { error: refundErr } = await service.rpc('credit_wallet' as never, {
                p_user_id: order.buyer_id,
                p_amount: order.total_paid,
                p_type: 'refund',
                p_description: `Hoàn tiền - Đơn #${String(order.id).substring(0, 8)} quá hạn giao`,
                p_reference_id: order.id,
            } as never);
            if (refundErr) {
                // Put the order back so a later run retries the refund. The card
                // stays relisted (harmless — it was reserved for this buyer only).
                await service.from('orders').update({ status: 'paid', updated_at: nowIso } as never).eq('id', order.id).eq('status', 'cancelled');
                continue;
            }

            // 3) Seller fault → lowers % reputation (best-effort; ignore errors,
            //    e.g. if the reputation RPC isn't deployed yet).
            await service.rpc('update_seller_reputation' as never, {
                p_seller_id: order.seller_id,
                p_success: 0,
                p_fault: 1,
            } as never);

            // 4) Notify both parties.
            await service.from('notifications').insert([
                { user_id: order.buyer_id, type: 'order_refunded', title: 'Đơn hàng đã huỷ - tiền đã hoàn', message: `Người bán không giao trong hạn. ${Number(order.total_paid).toLocaleString()}đ đã hoàn vào ví CardVerse của bạn.`, card_id: order.card_id, order_id: order.id, read: false },
                { user_id: order.seller_id, type: 'order_cancelled', title: 'Đơn hàng bị huỷ do quá hạn giao', message: 'Bạn không cập nhật mã vận đơn trong hạn. Đơn đã huỷ, tiền hoàn cho người mua và điểm uy tín bị trừ.', card_id: order.card_id, order_id: order.id, read: false },
            ] as never);

            cancelled += 1;
        } catch {
            // Leave it cancelled + relisted; a later run won't re-pick it (status
            // is no longer 'paid'), and the refund guard above already handled money.
        }
    }

    return cancelled;
}
