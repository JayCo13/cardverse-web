import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OfferActionResult = {
    replayed?: boolean;
    offer_id: string;
    card_id: string;
    buyer_id: string;
    seller_id: string;
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
        p_action: 'reject',
        p_idempotency_key: idempotencyKey,
    } as never);
    if (error) {
        const code = ['offer_not_pending', 'idempotency_conflict'].find(value => error.message.includes(value));
        return NextResponse.json(
            { error: code || error.message, code: code || 'offer_action_failed' },
            { status: code ? 409 : error.message.includes('forbidden') ? 403 : 400 },
        );
    }
    const result = data as OfferActionResult;

    let conversationId: string | null = null;
    const { data: existing } = await supabase.from('conversations').select('id')
        .eq('buyer_id', result.buyer_id).eq('seller_id', result.seller_id)
        .eq('card_id', result.card_id).maybeSingle();
    conversationId = (existing as { id?: string } | null)?.id || null;
    if (conversationId && !result.replayed) {
        const body = 'The seller rejected your offer. You can submit a new offer at a different price.';
        const { data: message } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body,
            message_type: 'system',
            metadata: { offerId: result.offer_id, cardId: result.card_id, kind: 'offer_rejected' },
            flagged_terms: [],
        } as never).select('id, created_at').single();
        if (message) {
            await supabase.from('conversations').update({
                offer_id: result.offer_id,
                last_message_id: (message as { id: string }).id,
                last_message_preview: body,
                last_message_at: (message as { created_at: string }).created_at,
                seller_last_read_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            } as never).eq('id', conversationId);
        }
    }

    return NextResponse.json({ offerId: result.offer_id, conversationId, replayed: !!result.replayed });
}
