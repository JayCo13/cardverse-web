import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formatVND = (amount: number) => new Intl.NumberFormat('en-US').format(amount) + ' VND';

type OfferActionResult = {
    ok?: boolean;
    replayed?: boolean;
    offer_id: string;
    card_id: string;
    buyer_id: string;
    seller_id: string;
    price: number;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: offerId } = await params;
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
        return NextResponse.json({ error: 'Valid Idempotency-Key is required' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase.rpc('perform_offer_action' as never, {
        p_offer_id: offerId,
        p_action: 'accept',
        p_idempotency_key: idempotencyKey,
    } as never);
    if (error) {
        const code = ['offer_not_pending', 'card_unavailable', 'idempotency_conflict']
            .find(value => error.message.includes(value));
        return NextResponse.json(
            { error: code || error.message, code: code || 'offer_action_failed' },
            { status: code ? 409 : error.message.includes('forbidden') ? 403 : 400 },
        );
    }
    const result = data as OfferActionResult;
    const checkoutUrl = `/checkout?offerId=${result.offer_id}`;

    // Chat is non-financial. It runs only for the first committed action; the
    // offer/card/loser state and notifications are already atomic in the RPC.
    let conversationId: string | null = null;
    const { data: existing } = await supabase.from('conversations').select('id')
        .eq('buyer_id', result.buyer_id).eq('seller_id', result.seller_id)
        .eq('card_id', result.card_id).maybeSingle();
    conversationId = (existing as { id?: string } | null)?.id || null;
    if (!conversationId && !result.replayed) {
        const { data: created } = await supabase.from('conversations').insert({
            buyer_id: result.buyer_id,
            seller_id: result.seller_id,
            card_id: result.card_id,
            offer_id: result.offer_id,
        } as never).select('id').maybeSingle();
        conversationId = (created as { id?: string } | null)?.id || null;
    }
    if (conversationId && !result.replayed) {
        const body = `The seller accepted your ${formatVND(Number(result.price))} offer. Continue to checkout to complete payment on CardVerse.`;
        const { data: message } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body,
            message_type: 'system',
            metadata: { offerId: result.offer_id, cardId: result.card_id, checkoutUrl, kind: 'offer_accepted', price: Number(result.price) },
        } as never).select('id, created_at').single();
        if (message) {
            await supabase.from('conversations').update({
                offer_id: result.offer_id,
                last_message_id: (message as { id: string }).id,
                last_message_preview: body,
                last_message_at: (message as { created_at: string }).created_at,
                updated_at: new Date().toISOString(),
            } as never).eq('id', conversationId);
        }
    }

    return NextResponse.json({ offerId: result.offer_id, checkoutUrl, conversationId, replayed: !!result.replayed });
}
