import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';

/**
 * Everything the persistent chrome needs about the signed-in account, in one
 * request.
 *
 * The header used to ask for this in two — `/api/cart?view=count` and
 * `/api/offers/inbox?summary=account` — and the seller dashboard asked for the
 * offer half a third time. On the production path a round trip costs 450-900ms
 * before the handler has done anything, so three requests for three small
 * numbers was most of a second of pure overhead, repeated on every navigation.
 *
 * Folding them together also collapses the work inside. The offer summary used
 * to read every card the seller owns, then feed those ids back into a second
 * query against `offers`; that is two sequential hops to the database where an
 * inner join is one. What remains is a single identity check followed by three
 * queries that do not depend on each other, issued together.
 *
 * The individual endpoints stay: they are still the right shape for the pages
 * that need the full cart or the full offer inbox.
 */
export async function GET() {
    const supabase = await createServerSupabaseClient();
    const user = await getRouteUser(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [cart, received, sent] = await Promise.all([
        supabase.from('cart_items')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
        // One hop, not two: the seller filter is applied to the joined card
        // rather than resolved into a list of ids by a preceding query.
        supabase.from('offers')
            .select('card_id, cards!inner(seller_id)')
            .eq('status', 'pending')
            .eq('cards.seller_id', user.id),
        supabase.from('offers')
            .select('id', { count: 'exact', head: true })
            .eq('buyer_id', user.id)
            .in('status', ['chosen', 'accepted']),
    ]);

    if (cart.error || received.error || sent.error) {
        const message = cart.error?.message || received.error?.message || sent.error?.message;
        return NextResponse.json({ error: message }, { status: 500 });
    }

    const receivedRows = (received.data || []) as Array<{ card_id: string }>;
    const cardPendingCounts = receivedRows.reduce<Record<string, number>>((result, offer) => {
        result[offer.card_id] = (result[offer.card_id] || 0) + 1;
        return result;
    }, {});
    const receivedPending = receivedRows.length;
    const sentAwaitingPayment = sent.count || 0;

    return NextResponse.json({
        cartCount: cart.count || 0,
        receivedPending,
        sentAwaitingPayment,
        actionCount: receivedPending + sentAwaitingPayment,
        cardPendingCounts,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}
