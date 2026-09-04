import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Announce a completed payment in the buyer/seller conversation.
 *
 * Payment used to be invisible in chat. The seller accepted an offer, the chat
 * grew a "Go to checkout" button, the buyer paid — and the thread said nothing.
 * The seller's only signal was a bell notification, which is not where either
 * party is actually talking, so nobody knew when to pack the card and the stale
 * checkout button still invited the buyer back to a paid order.
 *
 * Called from every path that can complete a payment (wallet checkout, the PayOS
 * webhook and its deferred drain, transaction pay, direct buy). Two of those have
 * no user session at all, so this runs on the service-role client.
 */

export type PaidOrderForChat = {
    id: string;
    card_id: string;
    buyer_id: string;
    seller_id: string;
    offer_id?: string | null;
    total_paid?: number | null;
    amount?: number | null;
};

const formatVND = (amount: number) =>
    `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

export async function announceOrderPaidInChat(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: SupabaseClient<any, any, any>,
    order: PaidOrderForChat,
) {
    try {
        // The conversation's natural key — the same lookup the offer routes use,
        // and backed by `conversations_context_unique (buyer_id, seller_id, card_id)`.
        const { data: conversation } = await service
            .from('conversations')
            .select('id, status')
            .eq('buyer_id', order.buyer_id)
            .eq('seller_id', order.seller_id)
            .eq('card_id', order.card_id)
            .maybeSingle();

        const conversationRow = conversation as { id?: string; status?: string } | null;
        const conversationId = conversationRow?.id;
        // No conversation means these two never chatted — a direct "buy now".
        // Opening a thread just to drop a receipt in it would be noise.
        if (!conversationId) return;
        // Blocked or archived threads take no messages. RLS enforced that until
        // this moved to the service-role client, which bypasses it.
        if (conversationRow?.status && conversationRow.status !== 'active') {
            console.warn('[OrderPaidChat] Skipping receipt for non-active conversation:', conversationId, conversationRow.status);
            return;
        }

        const price = order.total_paid ?? order.amount ?? 0;
        // Stored verbatim as the inbox preview, which is not localized for anyone.
        // Inside the thread the client renders `metadata.kind` in the viewer's own
        // language and never shows this string.
        const body = `Người mua đã thanh toán ${formatVND(price)}. Đơn hàng đang chờ người bán gửi đi.`;

        // Duplicate protection is the partial unique index on
        // (metadata->>'orderId') for order_paid receipts, not a read before the
        // write. Two callers can reach this line at once — the PayOS claim is only
        // at-least-once, and two wallet checkouts sharing an Idempotency-Key can
        // both see the same committed order — and a SELECT-then-INSERT loses that
        // race. Worse, once two rows existed the check itself would start erroring
        // and every retry would add another receipt.
        const { data: message, error: insertError } = await service
            .from('messages')
            .insert({
                conversation_id: conversationId,
                // The payer. Must be a real participant — `sender_id` is a FK to
                // `profiles` and RLS lets both parties read it.
                sender_id: order.buyer_id,
                body,
                message_type: 'system',
                metadata: {
                    kind: 'order_paid',
                    orderId: order.id,
                    cardId: order.card_id,
                    offerId: order.offer_id || null,
                    price,
                },
                flagged_terms: [],
            } as never)
            .select('id, created_at')
            .single();

        let created = message as { id: string; created_at: string } | null;

        // 23505 = unique violation: this order's receipt is already in the
        // thread. That is not a reason to stop — the previous attempt may have
        // died between writing the message and pointing the conversation at it,
        // which would leave the seller with a receipt in history and nothing in
        // their inbox to say it arrived. Look the existing one up and finish the
        // job it started.
        if (insertError) {
            if (insertError.code !== '23505') throw insertError;
            const { data: existing } = await service
                .from('messages')
                .select('id, created_at')
                .eq('conversation_id', conversationId)
                .eq('metadata->>kind', 'order_paid')
                .eq('metadata->>orderId', order.id)
                .limit(1)
                .maybeSingle();
            created = (existing as { id: string; created_at: string } | null) ?? null;
        }
        if (!created) return;

        // Two things this update deliberately does NOT do.
        //
        // It does not move `buyer_last_read_at`. Paying is not the same as having
        // read the thread: a seller who writes "what's your address?" while the
        // buyer is on the checkout page would have that message silently marked
        // read, and it would never raise a badge. A redundant badge on the
        // buyer's own receipt is the cheaper mistake.
        //
        // And it only moves the conversation forward. On a replay the row found
        // above is the ORIGINAL receipt, possibly hours old; writing its
        // timestamp back unconditionally would rewind the inbox preview and
        // reorder the list behind messages sent since. The `or(...)` makes the
        // update match no row at all when the conversation already points at
        // something newer, which is exactly the intent — and it decides that in
        // one statement, so two concurrent callers cannot interleave.
        await service
            .from('conversations')
            .update({
                last_message_id: created.id,
                last_message_preview: preview(body),
                last_message_at: created.created_at,
                updated_at: new Date().toISOString(),
            } as never)
            .eq('id', conversationId)
            .or(`last_message_at.is.null,last_message_at.lte.${created.created_at}`);
    } catch (error) {
        // The money is already committed. A chat failure must never fail the
        // payment, the webhook post-processing, or the buyer's checkout response.
        console.error('[OrderPaidChat] Unable to announce payment in chat:', error);
    }
}

/** Order states that mean the buyer's money has arrived. */
const PAID_STATUSES = new Set(['paid', 'shipping', 'delivered', 'completed', 'disputed']);

/**
 * Announce every paid order in a batch, given raw order rows.
 *
 * The wallet RPCs return full order rows (`to_jsonb(o)`), including on an
 * idempotent replay. Replays matter: if the RPC committed but the request died
 * before the announcement, the retry short-circuits at
 * `get_marketplace_checkout_replay` and the only chance to speak in chat would
 * otherwise be gone for good. Announcing from the rows themselves makes the
 * receipt a property of the order being paid rather than of the code path that
 * happened to pay it.
 */
export async function announcePaidOrdersInChat(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: SupabaseClient<any, any, any>,
    orders: unknown[],
) {
    for (const row of orders || []) {
        if (!row || typeof row !== 'object') continue;
        const order = row as Record<string, unknown>;
        if (typeof order.status === 'string' && !PAID_STATUSES.has(order.status)) continue;
        if (typeof order.id !== 'string' || typeof order.card_id !== 'string') continue;
        if (typeof order.buyer_id !== 'string' || typeof order.seller_id !== 'string') continue;

        await announceOrderPaidInChat(service, {
            id: order.id,
            card_id: order.card_id,
            buyer_id: order.buyer_id,
            seller_id: order.seller_id,
            offer_id: typeof order.offer_id === 'string' ? order.offer_id : null,
            total_paid: Number(order.total_paid ?? order.amount ?? 0),
        });
    }
}
