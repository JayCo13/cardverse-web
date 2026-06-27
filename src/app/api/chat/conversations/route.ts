import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type ConversationRow = {
    id: string;
    buyer_id: string;
    seller_id: string;
    card_id: string | null;
    offer_id: string | null;
    last_message_id: string | null;
    last_message_preview: string | null;
    last_message_at: string | null;
    buyer_last_read_at: string | null;
    seller_last_read_at: string | null;
    status: 'active' | 'archived' | 'blocked';
    created_at: string;
    updated_at: string;
};

const mapConversation = (
    conversation: ConversationRow,
    currentUserId: string,
    profiles: Map<string, any>,
    cards: Map<string, any>,
    mutedConversationIds: Set<string>,
) => {
    const otherUserId = conversation.buyer_id === currentUserId ? conversation.seller_id : conversation.buyer_id;
    const ownLastRead = conversation.buyer_id === currentUserId
        ? conversation.buyer_last_read_at
        : conversation.seller_last_read_at;
    const unread = !!conversation.last_message_at && (!ownLastRead || new Date(conversation.last_message_at) > new Date(ownLastRead));

    return {
        id: conversation.id,
        buyerId: conversation.buyer_id,
        sellerId: conversation.seller_id,
        cardId: conversation.card_id,
        offerId: conversation.offer_id,
        lastMessageId: conversation.last_message_id,
        lastMessagePreview: conversation.last_message_preview,
        lastMessageAt: conversation.last_message_at,
        buyerLastReadAt: conversation.buyer_last_read_at,
        sellerLastReadAt: conversation.seller_last_read_at,
        status: conversation.status,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        unread,
        muted: mutedConversationIds.has(conversation.id),
        otherUser: profiles.get(otherUserId) || null,
        card: conversation.card_id ? cards.get(conversation.card_id) || null : null,
    };
};

export async function GET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rows = (conversations || []) as ConversationRow[];
    const profileIds = Array.from(new Set(rows.flatMap(row => [row.buyer_id, row.seller_id])));
    const cardIds = Array.from(new Set(rows.map(row => row.card_id).filter(Boolean))) as string[];

    const [profilesResult, cardsResult] = await Promise.all([
        profileIds.length > 0
            ? supabase.from('profiles').select('id, display_name, email, profile_image_url, seller_verified').in('id', profileIds)
            : Promise.resolve({ data: [] as any[] }),
        cardIds.length > 0
            ? supabase.from('cards').select('id, name, image_url, price, status, seller_id').in('id', cardIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const { data: mutedPreferences } = rows.length > 0
        ? await supabase
            .from('conversation_notification_preferences')
            .select('conversation_id')
            .eq('user_id', user.id)
            .eq('muted', true)
            .in('conversation_id', rows.map(row => row.id))
        : { data: [] as Array<{ conversation_id: string }> };

    const profiles = new Map((profilesResult.data || []).map(profile => [profile.id, profile]));
    const cards = new Map((cardsResult.data || []).map(card => [card.id, card]));
    const mutedConversationIds = new Set((mutedPreferences || []).map(preference => preference.conversation_id));

    return NextResponse.json({
        conversations: rows.map(row => mapConversation(row, user.id, profiles, cards, mutedConversationIds)),
    });
}

export async function PATCH(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const conversationId = String(body.conversationId || body.conversation_id || '');
    const muted = body.muted;

    if (!conversationId || typeof muted !== 'boolean') {
        return NextResponse.json({ error: 'conversationId and muted are required' }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('id, buyer_id, seller_id')
        .eq('id', conversationId)
        .single();

    if (conversationError || !conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const conversationRow = conversation as { id: string; buyer_id: string; seller_id: string };
    if (conversationRow.buyer_id !== user.id && conversationRow.seller_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error: preferenceError } = await supabase
        .from('conversation_notification_preferences')
        .upsert({
            conversation_id: conversationId,
            user_id: user.id,
            muted,
            updated_at: new Date().toISOString(),
        } as never, { onConflict: 'conversation_id,user_id' });

    if (preferenceError) {
        return NextResponse.json({ error: preferenceError.message }, { status: 400 });
    }

    return NextResponse.json({ conversationId, muted });
}

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const cardId = String(body.cardId || body.card_id || '');
    const offerId = body.offerId || body.offer_id || null;

    if (!cardId) {
        return NextResponse.json({ error: 'cardId is required' }, { status: 400 });
    }

    const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, seller_id, name, image_url, price, status')
        .eq('id', cardId)
        .single();

    if (cardError || !card) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    let buyerId = user.id;
    const sellerId = (card as any).seller_id as string;

    if (offerId) {
        const { data: offer, error: offerError } = await supabase
            .from('offers')
            .select('id, buyer_id, card_id')
            .eq('id', offerId)
            .eq('card_id', cardId)
            .single();

        if (offerError || !offer) {
            return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
        }

        buyerId = (offer as any).buyer_id;
    }

    if (user.id !== buyerId && user.id !== sellerId) {
        return NextResponse.json({ error: 'You are not a participant in this conversation' }, { status: 403 });
    }

    if (buyerId === sellerId) {
        return NextResponse.json({ error: 'Cannot start a conversation with yourself' }, { status: 400 });
    }

    const { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('buyer_id', buyerId)
        .eq('seller_id', sellerId)
        .eq('card_id', cardId)
        .maybeSingle();

    let conversation = existing as ConversationRow | null;

    if (!conversation) {
        const { data: inserted, error: insertError } = await supabase
            .from('conversations')
            .insert({
                buyer_id: buyerId,
                seller_id: sellerId,
                card_id: cardId,
                offer_id: offerId,
            } as never)
            .select()
            .single();

        if (insertError || !inserted) {
            return NextResponse.json({ error: insertError?.message || 'Could not create conversation' }, { status: 400 });
        }
        conversation = inserted as ConversationRow;
    } else if (offerId && conversation.offer_id !== offerId) {
        const { data: updated } = await supabase
            .from('conversations')
            .update({ offer_id: offerId, updated_at: new Date().toISOString() } as never)
            .eq('id', conversation.id)
            .select()
            .single();
        conversation = (updated as unknown as ConversationRow | null) || conversation;
    }

    return NextResponse.json({ conversation });
}
