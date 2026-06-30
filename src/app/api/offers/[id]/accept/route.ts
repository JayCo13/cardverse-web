import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

// Seller accepts a buyer's offer. This is intentionally server-side so the
// seller/offer/card checks and the card-locking race guard cannot be bypassed
// from the client. Returns { checkoutUrl, conversationId } so the buyer pays
// through the unified checkout flow instead of the legacy Transaction Room.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: offerId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load the offer and its card so we can verify ownership and current state.
    const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, status')
        .eq('id', offerId)
        .single();

    if (offerError || !offer) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const offerRow = offer as {
        id: string; card_id: string; buyer_id: string; price: number; status: string;
    };

    const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, name, seller_id, status')
        .eq('id', offerRow.card_id)
        .single();

    if (cardError || !card) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const cardRow = card as { id: string; name: string; seller_id: string; status: string };

    if (cardRow.seller_id !== user.id) {
        return NextResponse.json({ error: 'Chỉ người bán mới có thể chấp nhận đề nghị.' }, { status: 403 });
    }

    if (offerRow.status !== 'pending') {
        return NextResponse.json(
            { error: 'Đề nghị này không còn ở trạng thái chờ.', code: 'offer_not_pending' },
            { status: 409 },
        );
    }

    if (cardRow.status !== 'active') {
        return NextResponse.json(
            { error: 'Thẻ này không còn khả dụng để giao dịch.', code: 'card_unavailable' },
            { status: 409 },
        );
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    // Race guard: only the request that flips the card from active -> in_transaction
    // is allowed to proceed; a concurrent accept gets no row back and aborts.
    const { data: lockedCard, error: lockError } = await supabase
        .from('cards')
        .update({ status: 'in_transaction', reserved_until: expiresAt.toISOString() } as never)
        .eq('id', cardRow.id)
        .eq('status', 'active')
        .select('id')
        .maybeSingle();

    if (lockError || !lockedCard) {
        return NextResponse.json(
            { error: 'Thẻ vừa được giữ cho một giao dịch khác.', code: 'card_unavailable' },
            { status: 409 },
        );
    }

    const { error: offerUpdateError } = await supabase
        .from('offers')
        .update({ status: 'chosen', transaction_id: null } as never)
        .eq('id', offerRow.id);

    if (offerUpdateError) {
        await supabase
            .from('cards')
            .update({ status: 'active', reserved_until: null } as never)
            .eq('id', cardRow.id);
        return NextResponse.json({ error: offerUpdateError.message || 'Không thể chấp nhận đề nghị.' }, { status: 400 });
    }

    const checkoutUrl = `/checkout?offerId=${offerRow.id}`;

    // Resolve (or create) the buyer/seller conversation for this card so the
    // notification and system message have somewhere to land.
    let conversationId: string | null = null;
    const { data: existingConversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('buyer_id', offerRow.buyer_id)
        .eq('seller_id', cardRow.seller_id)
        .eq('card_id', cardRow.id)
        .maybeSingle();

    if (existingConversation) {
        conversationId = (existingConversation as { id: string }).id;
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
        conversationId = createdConversation ? (createdConversation as { id: string }).id : null;
    }

    if (conversationId) {
        await supabase
            .from('conversations')
            .update({ offer_id: offerRow.id, updated_at: new Date().toISOString() } as never)
            .eq('id', conversationId);
    }

    if (conversationId) {
        const systemBody = `Người bán đã chấp nhận đề nghị ${formatVND(offerRow.price)}. Vào checkout để hoàn tất thanh toán trực tiếp trên CardVerse.`;
        const now = new Date().toISOString();
        const { data: systemMessage } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: user.id,
                body: systemBody,
                message_type: 'system',
                metadata: { offerId: offerRow.id, cardId: cardRow.id, checkoutUrl, kind: 'offer_accepted', price: Number(offerRow.price) },
            } as never)
            .select('id, created_at')
            .single();

        if (systemMessage) {
            await supabase
                .from('conversations')
                .update({
                    last_message_id: (systemMessage as { id: string }).id,
                    last_message_preview: systemBody,
                    last_message_at: (systemMessage as { created_at: string }).created_at,
                    updated_at: now,
                } as never)
                .eq('id', conversationId);
        }
    }

    await supabase.from('notifications').insert({
        user_id: offerRow.buyer_id,
        type: 'offer_accepted',
        title: 'Đề xuất được chấp nhận!',
        message: `Người bán đã chấp nhận đề xuất ${formatVND(offerRow.price)} của bạn. Vào checkout ngay!`,
        card_id: cardRow.id,
        offer_id: offerRow.id,
        conversation_id: conversationId,
        transaction_id: null,
        read: false,
    } as never);

    return NextResponse.json({ offerId: offerRow.id, checkoutUrl, conversationId });
}
