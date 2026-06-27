import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const formatVND = (amount: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: offerId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, status')
        .eq('id', offerId)
        .single();

    if (offerError || !offer) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const offerRow = offer as any;
    const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, name, seller_id')
        .eq('id', offerRow.card_id)
        .single();

    if (cardError || !card) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const cardRow = card as any;
    if (cardRow.seller_id !== user.id) {
        return NextResponse.json({ error: 'Only the seller can reject this offer' }, { status: 403 });
    }

    if (offerRow.status !== 'pending') {
        return NextResponse.json(
            { error: 'Đề nghị này không còn ở trạng thái chờ.', code: 'offer_not_pending' },
            { status: 409 },
        );
    }

    const { error: updateError } = await supabase
        .from('offers')
        .update({ status: 'rejected' } as never)
        .eq('id', offerId);

    if (updateError) {
        return NextResponse.json({ error: updateError.message || 'Không thể từ chối đề nghị.' }, { status: 400 });
    }

    let conversationId: string | null = null;
    const { data: existingConversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('buyer_id', offerRow.buyer_id)
        .eq('seller_id', cardRow.seller_id)
        .eq('card_id', cardRow.id)
        .maybeSingle();

    if (existingConversation) {
        conversationId = (existingConversation as any).id;
        await supabase
            .from('conversations')
            .update({ offer_id: offerRow.id, updated_at: new Date().toISOString() } as never)
            .eq('id', conversationId);
    } else {
        const { data: createdConversation } = await supabase
            .from('conversations')
            .insert({
                buyer_id: offerRow.buyer_id,
                seller_id: cardRow.seller_id,
                card_id: cardRow.id,
                offer_id: offerRow.id,
            } as never)
            .select('id')
            .single();
        conversationId = createdConversation ? (createdConversation as any).id : null;
    }

    if (conversationId) {
        const body = `Người bán đã từ chối đề nghị ${formatVND(Number(offerRow.price))}. Bạn có thể gửi offer mới với mức giá cao hơn.`;
        const { data: message } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: user.id,
                body,
                message_type: 'system',
                metadata: { offerId: offerRow.id, cardId: cardRow.id },
                flagged_terms: [],
            } as never)
            .select('id, created_at')
            .single();

        const now = new Date().toISOString();
        await supabase
            .from('conversations')
            .update({
                last_message_id: message ? (message as any).id : null,
                last_message_preview: preview(body),
                last_message_at: message ? (message as any).created_at : now,
                seller_last_read_at: now,
                updated_at: now,
                offer_id: offerRow.id,
            } as never)
            .eq('id', conversationId);
    }

    await supabase.from('notifications').insert({
        user_id: offerRow.buyer_id,
        type: 'offer_rejected',
        title: 'Offer bị từ chối',
        message: `Người bán đã từ chối đề xuất ${formatVND(Number(offerRow.price))} cho "${cardRow.name}".`,
        card_id: cardRow.id,
        offer_id: offerRow.id,
        conversation_id: conversationId,
        read: false,
    } as never);

    return NextResponse.json({ offerId: offerRow.id, conversationId });
}
