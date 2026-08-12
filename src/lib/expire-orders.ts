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
        // Cancellation, verified-parent validation, refund source, wallet and
        // ledger mutation are one transaction. A failed RPC leaves the paid
        // order untouched for a later retry.
        const { data: refundData, error: refundErr } = await service.rpc(
            'expire_verified_marketplace_order' as never,
            {
                p_order_id: order.id,
                p_reason: `Refund - Order #${String(order.id).substring(0, 8)} shipment overdue`,
            } as never,
        );
        if (refundErr) continue;
        const refundResult = refundData as { replayed?: boolean } | null;
        if (refundResult?.replayed) continue;

        try {
            // Seller fault → lowers % reputation (best-effort; ignore errors,
            //    e.g. if the reputation RPC isn't deployed yet).
            await service.rpc('update_seller_reputation' as never, {
                p_seller_id: order.seller_id,
                p_success: 0,
                p_fault: 1,
            } as never);

            cancelled += 1;
        } catch {
            // Financial settlement is already complete; only best-effort
            // inventory metadata/reputation/notifications can remain pending.
        }
    }

    return cancelled;
}
