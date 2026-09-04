import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getRequestLocale } from '@/lib/request-localization';
import { getOfferEmailRecipient } from '@/lib/offer-email-recipient';
import { sendOfferReceivedEmail } from '@/lib/mail';
import { matchBundleSelection, type BundleItem, type BundleSelection } from '@/lib/bundle';

const formatVND = (amount: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

type OfferRow = {
    id: string;
    card_id: string;
    buyer_id: string;
    price: number;
    message: string | null;
    status: 'pending' | 'accepted' | 'rejected' | 'chosen' | 'expired';
    transaction_id: string | null;
    bundle_selection: BundleSelection[] | null;
    created_at: string;
};

const OFFER_COLUMNS = 'id, card_id, buyer_id, price, message, status, transaction_id, bundle_selection, created_at';

/**
 * Terminal states a buyer may follow with a new offer.
 *
 * `expired` is here because an offer is closed for reasons that are not the
 * buyer's doing — the order it produced was cancelled when the seller failed to
 * ship. Treating that as a lock kept the buyer off a card that is back on the
 * market and that they are still entitled to bid on.
 */
const REOFFERABLE_STATUSES: ReadonlySet<OfferRow['status']> = new Set(['rejected', 'expired']);
const CARD_COLUMNS = 'id, seller_id, name, image_url, price, status, listing_type, accept_offers, min_offer_percent, is_bundle, bundle_items';

/** Read a browser-supplied bundle selection into the shape `@/lib/bundle` matches on. */
function readSelection(value: unknown): BundleSelection[] | null {
    if (!Array.isArray(value)) return null;
    const items = value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(item => ({ title: String(item.title ?? ''), price: Number(item.price ?? 0) }))
        .filter(item => item.price > 0);
    return items.length > 0 ? items : null;
}

const mapOffer = (offer: OfferRow) => ({
    id: offer.id,
    cardId: offer.card_id,
    buyerId: offer.buyer_id,
    price: Number(offer.price),
    message: offer.message,
    status: offer.status,
    transactionId: offer.transaction_id,
    bundleSelection: Array.isArray(offer.bundle_selection) ? offer.bundle_selection : null,
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
        .select(CARD_COLUMNS)
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
        .select(OFFER_COLUMNS)
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
    // A price floor is the seller's answer to this buyer's last offer, so only
    // the newest row can set one. An older rejection belongs to a round that has
    // since been closed out, and must not follow the buyer into the next one.
    const latestRejectedOffer = latestOffer && latestOffer.status === 'rejected' ? latestOffer : null;
    const canOfferAgain = !latestOffer || REOFFERABLE_STATUSES.has(latestOffer.status);

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
        .select(CARD_COLUMNS)
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

    // ── Bundle: the offer is for the cards the buyer picked, not the listing ──
    const isBundle = !!cardRow.is_bundle;
    const bundleItems: BundleItem[] = Array.isArray(cardRow.bundle_items) ? cardRow.bundle_items : [];
    let bundleSelection: BundleSelection[] | null = null;
    let canonicalSelection: BundleItem[] | null = null;
    let bundlePrice: number | null = null;

    if (isBundle && bundleItems.length > 0) {
        bundleSelection = readSelection(body.bundleSelection ?? body.bundle_selection);
        if (!bundleSelection) {
            return NextResponse.json(
                { error: 'Chọn ít nhất một thẻ trong bài đăng để gửi offer.', code: 'no_bundle_selection' },
                { status: 400 },
            );
        }
        // Same multiset match the payment RPC will redo under a row lock, so a
        // selection accepted here is one that can actually be paid for.
        const matched = matchBundleSelection(bundleItems, bundleSelection);
        if (!matched) {
            return NextResponse.json(
                { error: 'Một số thẻ bạn chọn không còn trong bài đăng. Vui lòng tải lại trang.', code: 'bundle_item_unavailable' },
                { status: 409 },
            );
        }
        // Store the listing's own items (publisher/set/season and all), not the
        // browser's minimal { title, price } selectors: checkout subtracts these
        // from bundle_items by exact JSONB equality.
        canonicalSelection = matched.matched;
        bundlePrice = matched.matchedTotal;
    }

    const listedPrice = bundlePrice ?? Number(cardRow.price || 0);
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
        .select(OFFER_COLUMNS)
        .eq('card_id', cardId)
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

    if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const existingOffers = (existingData || []) as OfferRow[];
    // Only the buyer's most recent offer decides whether they may send another.
    // Reading the whole history let a stale row from an earlier round — an offer
    // left 'chosen' after its order was cancelled — lock the buyer out for good.
    const latestOffer = existingOffers[0] || null;

    if (latestOffer?.status === 'pending') {
        return NextResponse.json(
            { error: 'Bạn đã gửi offer cho thẻ này. Vui lòng chờ người bán phản hồi.', code: 'pending_offer_exists', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    if (latestOffer && (latestOffer.status === 'accepted' || latestOffer.status === 'chosen')) {
        return NextResponse.json(
            { error: 'Offer của bạn đã được chấp nhận. Vui lòng tiếp tục thanh toán.', code: 'offer_already_accepted', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    if (latestOffer && !REOFFERABLE_STATUSES.has(latestOffer.status)) {
        return NextResponse.json(
            { error: 'Bạn chỉ có thể offer lại sau khi offer trước đã kết thúc.', code: 'offer_not_rejected', offers: existingOffers.map(mapOffer) },
            { status: 409 },
        );
    }

    // The floor stops a buyer walking their price down after a refusal, so only
    // an actual refusal may create one. An offer closed because the order it
    // produced was cancelled is not the buyer's doing, and must never force them
    // above a price the seller had already agreed to.
    const latestRejectedOffer = latestOffer && latestOffer.status === 'rejected' ? latestOffer : null;
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
            bundle_selection: canonicalSelection,
        } as never)
        .select(OFFER_COLUMNS)
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
        const existingConversationId = (existingConversation as { id: string }).id;
        conversationId = existingConversationId;
        await supabase
            .from('conversations')
            .update({ offer_id: offer.id, updated_at: new Date().toISOString() } as never)
            .eq('id', existingConversationId);
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

    // A blocked or archived conversation takes no messages. RLS used to enforce
    // this; the service-role client below bypasses RLS, so the check has to be
    // made here instead. It matters most for `offer_auto`, which carries the
    // buyer's own note — otherwise a blocked participant could keep talking by
    // attaching text to an offer.
    const conversationStatus = (existingConversation as { status?: string } | null)?.status;
    if (conversationId && conversationStatus && conversationStatus !== 'active') {
        console.warn('[Offers] Skipping chat message for non-active conversation:', conversationId, conversationStatus);
        conversationId = null;
    }

    if (conversationId) {
        const messageBody = `${latestOffer ? 'Gửi lại đề nghị' : 'Gửi đề nghị'} ${formatVND(price)} ${cardRow.name}${message ? `: ${message}` : '.'}`;
        // `offer_auto` is app-generated and exempt from content screening, so RLS
        // now refuses it from an authenticated user — otherwise anyone could post
        // a fake offer bubble with any price. The offer row above was already
        // validated and inserted for this caller.
        const offerChatService = createServiceSupabaseClient();
        const { data: messageRow } = await offerChatService
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
                    resend: !!latestOffer,
                },
                flagged_terms: [],
            } as never)
            .select('id, created_at')
            .single();

        const now = new Date().toISOString();
        await offerChatService
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

    // Email is supplementary to the durable in-app notification. A mail
    // provider outage must not roll back an offer that was already committed.
    try {
        const recipient = await getOfferEmailRecipient(cardRow.seller_id, getRequestLocale(request));
        await sendOfferReceivedEmail(recipient.email, {
            recipientName: recipient.name,
            cardName: cardRow.name,
            offerPrice: price,
            listingPrice: listedPrice,
            cardId,
        }, recipient.locale);
    } catch (mailError) {
        console.error('[Offers] Unable to prepare new-offer email:', mailError);
    }

    return NextResponse.json({
        offer: mapOffer(offer),
        conversationId,
    });
}
