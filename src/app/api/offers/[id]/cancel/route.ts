import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

type CancelResult = {
    ok: boolean;
    offer_id: string;
    card_id: string;
};

/**
 * The buyer hands back a card their accepted offer was holding.
 *
 * Without this the only way out of an accepted offer was to let the hour run
 * down, which costs the seller the full hour and leaves the held offers behind
 * it waiting for nothing. The standing penalty is the same either way — the
 * agreed table scores both at −5 — so what this buys is speed: the RPC releases
 * the card and revives the queued offers in the same transaction.
 *
 * No idempotency key, unlike accept/reject: `cancel_chosen_offer` refuses an
 * offer that is not `chosen`, so a replay is already a no-op that returns 409.
 */
async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: offerId } = await params;

    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase.rpc('cancel_chosen_offer' as never, {
        p_offer_id: offerId,
    } as never);

    if (error) {
        // `offer_payment_in_progress` is the one worth naming: the buyer has a
        // live payment they may still complete, and telling them "already
        // cancelled" would send them away from money in flight.
        const code = ['offer_not_chosen', 'offer_payment_in_progress', 'offer_not_found']
            .find(value => error.message.includes(value));
        return NextResponse.json(
            { error: code || error.message, code: code || 'offer_cancel_failed' },
            { status: code ? 409 : error.message.includes('forbidden') ? 403 : 400 },
        );
    }

    const result = data as CancelResult;

    // Same reasoning as the accept and reject routes: RLS does not let an
    // authenticated user post a `system` message, so the app's own voice goes
    // through the service role. Every id below came from the RPC, which already
    // established that this caller owns the offer.
    const service = createServiceSupabaseClient();
    const { data: existing } = await service.from('conversations')
        .select('id, status')
        .eq('buyer_id', user.id)
        .eq('card_id', result.card_id)
        .maybeSingle();
    const existingRow = existing as { id?: string; status?: string } | null;
    const conversationId = existingRow?.status === 'active' ? existingRow.id || null : null;

    if (conversationId) {
        const body = 'The buyer released this card, so it is back on the market.';
        const { data: message } = await service.from('messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body,
            message_type: 'system',
            metadata: { offerId: result.offer_id, cardId: result.card_id, kind: 'offer_released' },
            flagged_terms: [],
        } as never).select('id, created_at').single();
        if (message) {
            await service.from('conversations').update({
                last_message_id: (message as { id: string }).id,
                last_message_preview: body,
                last_message_at: (message as { created_at: string }).created_at,
                updated_at: new Date().toISOString(),
            } as never).eq('id', conversationId);
        }
    }

    return NextResponse.json({ offerId: result.offer_id, cardId: result.card_id, conversationId });
}

export const POST = accountRoute(handlePOST);
