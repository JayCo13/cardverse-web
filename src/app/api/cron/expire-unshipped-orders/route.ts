import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Auto-cancel paid orders the seller didn't ship within 24h: refund the buyer's
// wallet, restore the listing inventory, and add a seller fault (lowers % rep).
// Call on a schedule (cron/Vercel cron) — protect with CRON_SECRET if set.
export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const token = request.nextUrl.searchParams.get('token') || request.headers.get('x-cron-secret');
        if (token !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const service = createServiceSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data: due, error } = await service
        .from('orders')
        .select('id, buyer_id, seller_id, card_id, total_paid, metadata')
        .eq('status', 'paid')
        .lt('ship_deadline', nowIso)
        .limit(200);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: { id: string; ok: boolean; reason?: string }[] = [];

    for (const order of (due || []) as any[]) {
        // CAS claim: flip paid → cancelled. Only the winner refunds.
        const { data: claimed } = await service
            .from('orders')
            .update({ status: 'cancelled', updated_at: nowIso } as never)
            .eq('id', order.id)
            .eq('status', 'paid')
            .select('id')
            .maybeSingle();
        if (!claimed) {
            results.push({ id: order.id, ok: false, reason: 'state_changed' });
            continue;
        }

        try {
            // Refund the buyer's CardVerse wallet (atomic RPC).
            const { error: refundErr } = await service.rpc('credit_wallet' as never, {
                p_user_id: order.buyer_id,
                p_amount: order.total_paid,
                p_type: 'refund',
                p_description: `Hoàn tiền - Đơn #${String(order.id).substring(0, 8)} quá hạn giao`,
                p_reference_id: order.id,
            } as never);
            if (refundErr) {
                // Put the order back so a later run can retry the refund.
                await service.from('orders').update({ status: 'paid', updated_at: nowIso } as never).eq('id', order.id).eq('status', 'cancelled');
                results.push({ id: order.id, ok: false, reason: 'refund_failed' });
                continue;
            }

            // Restore inventory: bundle → add the bought cards back; else → active.
            const selection = Array.isArray(order.metadata?.bundle_selection) ? order.metadata.bundle_selection : [];
            if (selection.length > 0) {
                const { data: cardRow } = await service.from('cards').select('bundle_items').eq('id', order.card_id).single();
                const items = Array.isArray((cardRow as any)?.bundle_items) ? (cardRow as any).bundle_items : [];
                await service
                    .from('cards')
                    .update({ bundle_items: [...items, ...selection] as never, status: 'active', reserved_until: null, updated_at: nowIso } as never)
                    .eq('id', order.card_id);
            } else {
                await service
                    .from('cards')
                    .update({ status: 'active', reserved_until: null, updated_at: nowIso } as never)
                    .eq('id', order.card_id)
                    .in('status', ['sold', 'in_transaction']);
            }

            // Seller fault → lowers % reputation.
            await service.rpc('update_seller_reputation' as never, {
                p_seller_id: order.seller_id,
                p_success: 0,
                p_fault: 1,
            } as never);

            // Notify both parties.
            await service.from('notifications').insert([
                {
                    user_id: order.buyer_id,
                    type: 'order_refunded',
                    title: 'Đơn hàng đã huỷ - tiền đã hoàn',
                    message: `Người bán không giao trong 24h. ${Number(order.total_paid).toLocaleString()}đ đã hoàn vào ví CardVerse của bạn.`,
                    card_id: order.card_id,
                    order_id: order.id,
                },
                {
                    user_id: order.seller_id,
                    type: 'order_cancelled',
                    title: 'Đơn hàng bị huỷ do quá hạn giao',
                    message: 'Bạn không cập nhật mã vận đơn trong 24h. Đơn đã huỷ, tiền hoàn cho người mua và điểm uy tín bị trừ.',
                    card_id: order.card_id,
                    order_id: order.id,
                },
            ] as never);

            results.push({ id: order.id, ok: true });
        } catch (e: any) {
            results.push({ id: order.id, ok: false, reason: e?.message || 'error' });
        }
    }

    return NextResponse.json({ processed: results.length, cancelled: results.filter(r => r.ok).length, results });
}
