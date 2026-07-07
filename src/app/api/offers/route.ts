import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const formatVND = (amount: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

type OfferRow = {
    id: string;
    card_id: string;
    buyer_id: string;
    price: number;
    message: string | null;
    status: 'pending' | 'accepted' | 'rejected' | 'chosen';
    transaction_id: string | null;
    created_at: string;
};

const mapOffer = (offer: OfferRow) => ({
    id: offer.id,
    cardId: offer.card_id,
    buyerId: offer.buyer_id,
    price: Number(offer.price),
    message: offer.message,
    status: offer.status,
    transactionId: offer.transaction_id,
    createdAt: offer.created_at,
});

async function getUserAndCard(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return { supabase, user: null, card: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const url = new URL(request.url);
    const cardId = String(url.searchParams.get('cardId') || url.searchParams.get('card_id') || '');

    if (!cardId) {
        return { supabase, user, card: null, error: NextResponse.json({ error: 'cardId is required' }, { status: 400 }) };
    }

    const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, seller_id, name, image_url, price, status, listing_type, accept_offers, min_offer_percent')
        .eq('id', cardId)
        .single();

    if (cardError || !card) {
        return { supabase, user, card: null, error: NextResponse.json({ error: 'Card not found' }, { status: 404 }) };
    }

    return { supabase, user, card: card as any, error: null };
}

export async function GET(request: NextRequest) {
    const { supabase, user, card, error } = await getUserAndCard(request);
    if (error) return error;
    if (!user || !card) {
        return NextResponse.json({ error: 'Unable to load offers' }, { status: 400 });
    }

    const { data, error: offersError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, message, status, transaction_id, created_at')
        .eq('card_id', card.id)
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

    if (offersError) {
        return NextResponse.json({ error: offersError.message }, { status: 400 });
    }

    const offers = ((data || []) as OfferRow[]).map(mapOffer);
    const latestOffer = offers[0] || null;
    const pendingOffer = offers.find(offer => offer.status === 'pending') || null;
    const acceptedOffer = offers.find(offer => offer.status === 'accepted' || offer.status === 'chosen') || null;
    const latestRejectedOffer = offers.find(offer => offer.status === 'rejected') || null;
    const canOfferAgain = !pendingOffer && !acceptedOffer && (!latestOffer || latestOffer.status === 'rejected');

    return NextResponse.json({
        offers,
        latestOffer,
        pendingOffer,
        acceptedOffer,
        latestRejectedOffer,
        canOfferAgain,
        minimumNextOffer: latestRejectedOffer ? Number(latestRejectedOffer.price) + 1 : null,
    });
}

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const cardId = String(body.cardId || body.card_id || '');
    const price = Number(body.price);
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!cardId || !Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: 'cardId and a valid price are required' }, { status: 400 });
    }

    const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, seller_id, name, image_url, price, status, listing_type, accept_offers, min_offer_percent')
        .eq('id', cardId)
        .single();

    if (cardError || !card) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const cardRow = card as any;
    if (cardRow.seller_id === user.id) {
        return NextResponse.json({ error: 'Bạn không thể tự trả giá bài đăng của mình.' }, { status: 403 });
    }

    if (cardRow.status !== 'active' || cardRow.listing_type !== 'sale' || !cardRow.accept_offers) {
        return NextResponse.json({ error: 'Listing này hiện không nhận offer.' }, { status: 409 });
    }

    const listedPrice = Number(cardRow.price || 0);
    const minOfferPercent = Number(cardRow.min_offer_percent || 0);
    const minOffer = minOfferPercent > 0 ? Math.ceil((listedPrice * minOfferPercent) / 100) : 0;
    if (minOffer > 0 && price < minOffer) {
        return NextResponse.json(
            { error: `Offer tối thiểu là ${formatVND(minOffer)}.`, code: 'below_min_offer', minOffer },
            { status: 422 },
        );
    }

    const { data: existingData, error: existingError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, message, status, transaction_id, created_at')
        .eq('card_id', cardId)
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

    if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const existingOffers = (existingData || []) as OfferRow[];
    const pendingOffer = existingOffers.find(offer => offer.status === 'pending');
    if (pendingOffer) {
        return NextResponse.json(
            { error: 'Bạn đã gửi offer cho thẻ này. Vui lòng chờ người bán phản hồi.', code: 'pending_offer_exists', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    const acceptedOffer = existingOffers.find(offer => offer.status === 'accepted' || offer.status === 'chosen');
    if (acceptedOffer) {
        return NextResponse.json(
            { error: 'Offer của bạn đã được chấp nhận. Vui lòng tiếp tục thanh toán.', code: 'offer_already_accepted', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    const latestOffer = existingOffers[0] || null;
    const latestRejectedOffer = existingOffers.find(offer => offer.status === 'rejected') || null;
    if (latestOffer && latestOffer.status !== 'rejected') {
        return NextResponse.json(
            { error: 'Bạn chỉ có thể offer lại sau khi offer trước bị từ chối.', code: 'offer_not_rejected', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    if (latestRejectedOffer && price <= Number(latestRejectedOffer.price)) {
        return NextResponse.json(
            {
                error: `Offer mới phải cao hơn offer đã bị từ chối (${formatVND(Number(latestRejectedOffer.price))}).`,
                code: 'must_offer_higher',
                minimumNextOffer: Number(latestRejectedOffer.price) + 1,
                offers: existingOffers.map(mapOffer),
            },
            { status: 422 },
        );
    }

    const { data: inserted, error: insertError } = await supabase
        .from('offers')
        .insert({
            card_id: cardId,
            buyer_id: user.id,
            price,
            message: message || null,
            status: 'pending',
        } as never)
        .select('id, card_id, buyer_id, price, message, status, transaction_id, created_at')
        .single();

    if (insertError || !inserted) {
        return NextResponse.json({ error: insertError?.message || 'Không thể tạo offer.' }, { status: 400 });
    }

    const offer = inserted as unknown as OfferRow;

    let conversationId: string | null = null;
    const { data: existingConversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('buyer_id', user.id)
        .eq('seller_id', cardRow.seller_id)
        .eq('card_id', cardId)
        .maybeSingle();

    if (existingConversation) {
        conversationId = (existingConversation as any).id;
        await supabase
            .from('conversations')
            .update({ offer_id: offer.id, updated_at: new Date().toISOString() } as never)
            .eq('id', conversationId);
    } else {
        const { data: createdConversation } = await supabase
            .from('conversations')
            .insert({
                buyer_id: user.id,
                seller_id: cardRow.seller_id,
                card_id: cardId,
                offer_id: offer.id,
            } as never)
            .select('id')
            .single();
        conversationId = createdConversation ? (createdConversation as any).id : null;
    }

    if (conversationId) {
        const messageBody = `${latestRejectedOffer ? 'Gửi lại đề nghị' : 'Gửi đề nghị'} ${formatVND(price)} ${cardRow.name}${message ? `: ${message}` : '.'}`;
        const { data: messageRow } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: user.id,
                body: messageBody,
                message_type: 'offer_auto',
                // Store the parts separately so the chat can render the price and
                // the buyer's note distinctly instead of one merged sentence.
                metadata: {
                    offerId: offer.id,
                    cardId,
                    price,
                    cardName: cardRow.name,
                    offerText: message || null,
                    resend: !!latestRejectedOffer,
                },
                flagged_terms: [],
            } as never)
            .select('id, created_at')
            .single();

        const now = new Date().toISOString();
        await supabase
            .from('conversations')
            .update({
                last_message_id: messageRow ? (messageRow as any).id : null,
                last_message_preview: preview(messageBody),
                last_message_at: messageRow ? (messageRow as any).created_at : now,
                buyer_last_read_at: now,
                updated_at: now,
                offer_id: offer.id,
            } as never)
            .eq('id', conversationId);
    }

    await createServiceSupabaseClient().from('notifications').insert({
        user_id: cardRow.seller_id,
        type: 'offer_received',
        title: 'Đề xuất giá mới',
        message: `Có người đề xuất ${formatVND(price)} cho thẻ "${cardRow.name}"`,
        card_id: cardId,
        offer_id: offer.id,
        conversation_id: conversationId,
        read: false,
    } as never);

    return NextResponse.json({
        offer: mapOffer(offer),
        conversationId,
    });
}
