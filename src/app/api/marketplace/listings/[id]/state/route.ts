import { accountRoute, getAccountRouteContext } from '@/lib/account-route';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

type ListingAction = 'hide' | 'restore' | 'delete';

type ManageListingResult = {
    listingId: string;
    visibility: 'visible' | 'hidden' | 'deleted';
    replayed?: boolean;
    rejectedOfferCount?: number;
    rejectedOfferIds?: string[];
};

const ACTIONS = new Set<ListingAction>(['hide', 'restore', 'delete']);

async function addHiddenListingMessages(
    sellerId: string,
    cardId: string,
    offerIds: string[],
) {
    if (offerIds.length === 0) return;
    const service = createServiceSupabaseClient();
    const { data: offers, error: offersError } = await service
        .from('offers')
        .select('id, buyer_id')
        .in('id', offerIds);
    if (offersError || !offers?.length) {
        if (offersError) console.error('[Listing state] Could not load rejected offers:', offersError.message);
        return;
    }

    const buyerIds = offers.map(offer => (offer as { buyer_id: string }).buyer_id);
    const { data: conversations, error: conversationsError } = await service
        .from('conversations')
        .select('id, buyer_id, status')
        .eq('seller_id', sellerId)
        .eq('card_id', cardId)
        .in('buyer_id', buyerIds);
    if (conversationsError) {
        console.error('[Listing state] Could not load conversations:', conversationsError.message);
        return;
    }

    const offerByBuyer = new Map(offers.map(offer => {
        const row = offer as { id: string; buyer_id: string };
        return [row.buyer_id, row.id];
    }));
    await Promise.all((conversations || []).map(async conversation => {
        const row = conversation as { id: string; buyer_id: string; status: string };
        const offerId = offerByBuyer.get(row.buyer_id);
        if (row.status !== 'active' || !offerId) return;
        const body = 'The seller closed this listing, so your offer was rejected.';
        const { data: message, error: messageError } = await service.from('messages').insert({
            conversation_id: row.id,
            sender_id: sellerId,
            body,
            message_type: 'system',
            metadata: { offerId, cardId, kind: 'offer_rejected', reason: 'listing_hidden' },
            flagged_terms: [],
        } as never).select('id, created_at').single();
        if (messageError || !message) {
            if (messageError) console.error('[Listing state] Could not add system message:', messageError.message);
            return;
        }
        await service.from('conversations').update({
            offer_id: offerId,
            last_message_id: (message as { id: string }).id,
            last_message_preview: body,
            last_message_at: (message as { created_at: string }).created_at,
            seller_last_read_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        } as never).eq('id', row.id);
    }));
}

async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { supabase, user } = await getAccountRouteContext(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    const action = body?.action;
    if (typeof action !== 'string' || !ACTIONS.has(action as ListingAction)) {
        return NextResponse.json({ error: 'Invalid listing action', code: 'invalid_listing_action' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('manage_own_listing' as never, {
        p_listing_id: id,
        p_action: action,
    } as never);
    if (error) {
        const code = [
            'listing_not_found', 'listing_not_hideable', 'listing_not_restorable',
            'listing_hide_before_delete', 'listing_transaction_locked',
            'seller_not_approved', 'account_banned',
        ].find(value => error.message.includes(value)) || 'listing_action_failed';
        const status = code === 'listing_not_found' ? 404
            : code === 'account_banned' ? 403
                : code === 'listing_action_failed' ? 400 : 409;
        return NextResponse.json({ error: code, code }, { status });
    }

    const result = data as ManageListingResult;
    if (action === 'hide' && !result.replayed && result.rejectedOfferIds?.length) {
        // Bell notifications are committed by the RPC. Chat is deliberately
        // best-effort, matching the existing manual reject route.
        try {
            await addHiddenListingMessages(user.id, id, result.rejectedOfferIds);
        } catch (chatError) {
            console.error('[Listing state] Hidden-listing chat failed:', chatError);
        }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = accountRoute(handlePOST);
