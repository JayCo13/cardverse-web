import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';

type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'chosen' | 'expired';
type StatusFilter = 'all' | 'pending' | 'awaiting_payment' | 'history';

type OfferRow = {
    id: string;
    card_id: string;
    buyer_id: string;
    price: number;
    message: string | null;
    status: OfferStatus;
    transaction_id: string | null;
    bundle_selection: Array<{ title?: string; price?: number }> | null;
    created_at: string;
};

type CardRow = {
    id: string;
    seller_id: string;
    name: string;
    image_url: string | null;
    price: number | null;
    status: string;
};

type ProfileRow = {
    id: string;
    display_name: string | null;
    profile_image_url: string | null;
    seller_verified: boolean | null;
};

type Cursor = { createdAt: string; id: string; price?: number };

const decodeCursor = (value: string | null): Cursor | null => {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
        if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
        return { createdAt: parsed.createdAt, id: parsed.id, price: typeof parsed.price === 'number' ? parsed.price : undefined };
    } catch {
        return null;
    }
};

const encodeCursor = (offer: OfferRow) => Buffer.from(JSON.stringify({
    createdAt: offer.created_at,
    id: offer.id,
    price: Number(offer.price),
})).toString('base64url');

const applyStatus = <T extends {
    eq: (column: string, value: string) => T;
    in: (column: string, values: string[]) => T;
}>(query: T, status: StatusFilter): T => {
    if (status === 'pending') return query.eq('status', 'pending');
    if (status === 'awaiting_payment') return query.in('status', ['chosen', 'accepted']);
    if (status === 'history') return query.in('status', ['rejected', 'expired']);
    return query;
};

export async function GET(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const user = await getRouteUser(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = request.nextUrl.searchParams;
    if (params.get('summary') === 'account') {
        // One hop, not two. This used to read every card the seller owns and
        // then feed those ids back into a second query, which is two sequential
        // round trips to the database for a number the join can produce in one.
        const receivedPromise = supabase.from('offers')
            .select('card_id, cards!inner(seller_id)')
            .eq('status', 'pending')
            .eq('cards.seller_id', user.id);
        const sentPromise = supabase.from('offers').select('id', { count: 'exact', head: true })
            .eq('buyer_id', user.id).in('status', ['chosen', 'accepted']);
        const [received, sent] = await Promise.all([receivedPromise, sentPromise]);
        if (received.error || sent.error) {
            return NextResponse.json({ error: received.error?.message || sent.error?.message }, { status: 400 });
        }
        const receivedRows = (received.data || []) as Array<{ card_id: string }>;
        const cardPendingCounts = receivedRows.reduce<Record<string, number>>((result, offer) => {
            result[offer.card_id] = (result[offer.card_id] || 0) + 1;
            return result;
        }, {});
        const receivedPending = receivedRows.length;
        const sentAwaitingPayment = sent.count || 0;
        return NextResponse.json({
            receivedPending,
            sentAwaitingPayment,
            actionCount: receivedPending + sentAwaitingPayment,
            cardPendingCounts,
        });
    }

    const view = params.get('view') === 'sent' ? 'sent' : 'received';
    const requestedStatus = params.get('status');
    const status: StatusFilter = ['all', 'pending', 'awaiting_payment', 'history'].includes(requestedStatus || '')
        ? requestedStatus as StatusFilter
        : view === 'received' ? 'pending' : 'all';
    const cardId = params.get('cardId')?.trim() || null;
    const requestedLimit = Number(params.get('limit') || 20);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
    const cursor = decodeCursor(params.get('cursor'));
    if (params.has('cursor') && !cursor) {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    const cards: CardRow[] = [];
    if (view === 'received' || cardId) {
        let cardsQuery = supabase
            .from('cards')
            .select('id, seller_id, name, image_url, price, status');
        if (view === 'received') cardsQuery = cardsQuery.eq('seller_id', user.id);
        if (cardId) cardsQuery = cardsQuery.eq('id', cardId);
        const { data: cardData, error: cardsError } = await cardsQuery;
        if (cardsError) return NextResponse.json({ error: cardsError.message }, { status: 400 });
        cards.push(...((cardData || []) as CardRow[]));
        if (cardId && cards.length === 0) {
            return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
        }
    }

    const cardIds = cards.map(card => card.id);
    if (view === 'received' && cardIds.length === 0) {
        return NextResponse.json({ items: [], counts: { pending: 0, awaitingPayment: 0, history: 0 }, nextCursor: null });
    }

    let offersQuery = supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, message, status, transaction_id, bundle_selection, created_at');
    offersQuery = view === 'received'
        ? offersQuery.in('card_id', cardIds)
        : offersQuery.eq('buyer_id', user.id);
    if (view === 'sent' && cardId) offersQuery = offersQuery.eq('card_id', cardId);
    offersQuery = applyStatus(offersQuery, status);
    const priceSorted = status === 'pending';
    if (cursor) {
        offersQuery = priceSorted && cursor.price != null
            ? offersQuery.or(
                `price.lt.${cursor.price},and(price.eq.${cursor.price},created_at.lt.${cursor.createdAt}),and(price.eq.${cursor.price},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
            )
            : offersQuery.or(
                `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
            );
    }
    if (priceSorted) offersQuery = offersQuery.order('price', { ascending: false });
    const { data: offerData, error: offersError } = await offersQuery
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
    if (offersError) return NextResponse.json({ error: offersError.message }, { status: 400 });

    const pageRows = (offerData || []) as OfferRow[];
    const hasMore = pageRows.length > limit;
    const offers = pageRows.slice(0, limit);

    const missingCardIds = view === 'sent'
        ? Array.from(new Set(offers.map(offer => offer.card_id).filter(id => !cardIds.includes(id))))
        : [];
    if (missingCardIds.length > 0) {
        const { data } = await supabase
            .from('cards')
            .select('id, seller_id, name, image_url, price, status')
            .in('id', missingCardIds);
        cards.push(...((data || []) as CardRow[]));
    }

    const cardMap = new Map(cards.map(card => [card.id, card]));
    const counterpartyIds = Array.from(new Set(offers.map(offer => view === 'received'
        ? offer.buyer_id
        : cardMap.get(offer.card_id)?.seller_id,
    ).filter(Boolean))) as string[];
    const offerIds = offers.map(offer => offer.id);

    const [profilesResult, conversationsResult] = await Promise.all([
        counterpartyIds.length > 0
            ? supabase.from('profiles').select('id, display_name, profile_image_url, seller_verified').in('id', counterpartyIds)
            : Promise.resolve({ data: [] as ProfileRow[], error: null }),
        offerIds.length > 0
            ? supabase.from('conversations').select('id, offer_id').in('offer_id', offerIds)
            : Promise.resolve({ data: [] as Array<{ id: string; offer_id: string | null }>, error: null }),
    ]);
    if (profilesResult.error) return NextResponse.json({ error: profilesResult.error.message }, { status: 400 });
    if (conversationsResult.error) return NextResponse.json({ error: conversationsResult.error.message }, { status: 400 });

    const profileMap = new Map(((profilesResult.data || []) as ProfileRow[]).map(profile => [profile.id, profile]));
    const conversationMap = new Map((conversationsResult.data || [])
        .filter(row => row.offer_id)
        .map(row => [row.offer_id as string, row.id]));

    const countOffers = async (statuses: OfferStatus[]) => {
        let query = supabase.from('offers').select('id', { count: 'exact', head: true });
        query = view === 'received' ? query.in('card_id', cardIds) : query.eq('buyer_id', user.id);
        if (cardId) query = query.eq('card_id', cardId);
        const result = await query.in('status', statuses);
        if (result.error) throw result.error;
        return result.count || 0;
    };

    try {
        const [pending, awaitingPayment, history] = await Promise.all([
            countOffers(['pending']),
            countOffers(['chosen', 'accepted']),
            countOffers(['rejected', 'expired']),
        ]);

        return NextResponse.json({
            items: offers.map(offer => {
                const card = cardMap.get(offer.card_id) || null;
                const counterpartyId = view === 'received' ? offer.buyer_id : card?.seller_id;
                return {
                    id: offer.id,
                    cardId: offer.card_id,
                    buyerId: offer.buyer_id,
                    price: Number(offer.price),
                    message: offer.message,
                    status: offer.status,
                    transactionId: offer.transaction_id,
                    createdAt: offer.created_at,
                    bundleSelection: Array.isArray(offer.bundle_selection) ? offer.bundle_selection : null,
                    conversationId: conversationMap.get(offer.id) || null,
                    card: card ? {
                        id: card.id,
                        name: card.name,
                        imageUrl: card.image_url,
                        price: card.price == null ? null : Number(card.price),
                        status: card.status,
                    } : null,
                    counterparty: counterpartyId ? profileMap.get(counterpartyId) || null : null,
                };
            }),
            counts: { pending, awaitingPayment, history },
            nextCursor: hasMore && offers.length > 0 ? encodeCursor(offers[offers.length - 1]) : null,
            selectedCard: cardId && cardMap.has(cardId) ? (() => {
                const card = cardMap.get(cardId)!;
                return { id: card.id, name: card.name, imageUrl: card.image_url, price: card.price == null ? null : Number(card.price), status: card.status };
            })() : null,
        });
    } catch (error: unknown) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unable to count offers' },
            { status: 400 },
        );
    }
}
