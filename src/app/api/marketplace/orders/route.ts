import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isEvidenceVideoUrl } from '@/lib/evidence-video';
import { getCarrier, getTrackingUrl, getDeliveryDays } from '@/lib/shipping-carriers';
import { sendOrderShippedEmail } from '@/lib/mail';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';
import type { Database } from '@/lib/supabase/database.types';

type OrderRow = Database['public']['Tables']['orders']['Row'];

// GET: Fetch orders for current user


async function handleGET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const user = await getRouteUser(supabase);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Self-healing escrow release: pay out any delivered order whose 72h
        // confirmation window lapsed. A seller checking their orders triggers
        // their own payout (same pattern as release_expired_card_reservations).
        await supabase.rpc('complete_delivered_orders' as never);

        // Self-healing: auto-cancel PAID orders the seller never shipped in time
        // (relist the card + refund the buyer), so overdue orders resolve even
        // without an external scheduler. Best-effort — never block the listing.
        try {
            await expireUnshippedPaidOrders(createServiceSupabaseClient());
        } catch (e) {
            console.error('expireUnshippedPaidOrders failed:', e);
        }


        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        // Which side of the marketplace the caller is asking about.
        //
        // Omitting `role` asks the server to choose, and it answers with the
        // side the caller actually works on. The decision lives here because
        // the data it needs does, and because the page cannot pick a tab before
        // it knows — resolving it client-side meant rendering the purchases tab
        // first and yanking a seller off it a moment later.
        //
        // "Seller" is `seller_verified` OR having sold anything, not the flag
        // alone. The flag means "allowed to sell", which is not the same as
        // "is here to sell": the busiest seller in the database, 27 orders,
        // currently has seller_verified = false, and sending them to purchases
        // is exactly the bug this resolves. The flag still counts on its own so
        // that a newly approved seller lands on the tab their first sale will
        // arrive in, rather than on someone else's.
        //
        // The resolved role is echoed back so the caller can label the view.
        const requested = searchParams.get('role');
        let role: 'buyer' | 'seller';
        if (requested === 'buyer' || requested === 'seller') {
            role = requested;
        } else {
            const [{ data: viewer }, { data: anySale }] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('seller_verified')
                    .eq('id', user.id)
                    .maybeSingle<{ seller_verified: boolean | null }>(),
                supabase
                    .from('orders')
                    .select('id')
                    .eq('seller_id', user.id)
                    .limit(1)
                    .maybeSingle<{ id: string }>(),
            ]);
            role = viewer?.seller_verified || anySale ? 'seller' : 'buyer';
        }

        let query = supabase
            .from('orders')
            .select(`
                *,
                card:cards(id, name, image_url, category, condition),
                buyer:profiles!orders_buyer_id_fkey(id, display_name, email, profile_image_url),
                seller:profiles!orders_seller_id_fkey(id, display_name, email, profile_image_url, seller_verified, reputation_score, reputation_incidents_90d, reputation_incidents_total, completed_transactions)
            `)
            .order('created_at', { ascending: false });

        if (role === 'buyer') {
            query = query.eq('buyer_id', user.id);
        } else {
            query = query.eq('seller_id', user.id);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) throw error;

        return NextResponse.json({ orders: data || [], role });
    } catch (error: any) {
        console.error('Get orders error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

// PATCH: Update order status
async function handlePATCH(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { order_id, action, tracking_number, shipping_provider, dispute_reason } = body;

        // Evidence videos are uploaded straight to Cloudinary by the browser,
        // which then posts back the URL. Anything that is not a video in our own
        // cloud and our own evidence folder is discarded rather than rejected:
        // the packing video is optional, and a shipment must not fail over it.
        const evidenceVideoUrl = (value: unknown): string | null =>
            isEvidenceVideoUrl(value, process.env.CLOUDINARY_CLOUD_NAME) ? value : null;
        const idempotencyKey = request.headers.get('idempotency-key');

        if (!order_id || !action) {
            return NextResponse.json({ error: 'order_id and action are required' }, { status: 400 });
        }
        if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
            return NextResponse.json({ error: 'Idempotency-Key is required', code: 'idempotency_key_required' }, { status: 400 });
        }

        // Get the order
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order_id)
            .single();

        if (orderError || !orderData) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }
        const order = orderData as OrderRow;

        // Cross-user writes (wallet credits, notifications to the other party)
        // go through the service client — both tables are RLS-locked for
        // client sessions.
        const service = createServiceSupabaseClient();

        switch (action) {
            // 'ship' is gone. Sellers no longer type a carrier and a tracking
            // number: a waybill is booked through GoShip from the order itself,
            // which issues the code, files the carrier's own number when it
            // arrives, and moves the order to shipping when the carrier
            // actually collects. See /api/shipping/book.
            case 'confirm_received': {
                // Only the buyer can confirm receipt. If the buyer stays silent,
                // the order escalates to admin review (never auto-pays the seller).
                if (order.buyer_id !== user.id) {
                    return NextResponse.json({ error: 'Only buyer can confirm' }, { status: 403 });
                }
                // Order completion, verified escrow release, seller balance,
                // provenance source and ledger are committed in one RPC.
                const { data: payoutData, error: payoutError } = await service.rpc(
                    'perform_marketplace_order_action' as never,
                    {
                        p_order_id: order_id,
                        p_action: 'confirm_received',
                        p_actor_id: user.id,
                        p_idempotency_key: idempotencyKey,
                        p_payload: {},
                    } as never,
                );
                if (payoutError) throw payoutError;
                const payoutResult = payoutData as { seller_payout?: number; replayed?: boolean } | null;
                // Record the completed sale for VN market pricing — only
                // standardized single-card listings (with a catalog key) count,
                // so open asking prices can never skew the aggregate. Never
                // let a pricing write break order confirmation.
                if (!payoutResult?.replayed) try {
                    const completedOrder = order as any;
                    const { data: soldCard } = await supabase
                        .from('cards')
                        .select('id, category, catalog_product_id, catalog_soccer_id, card_number, language, grading_company, grade, finish, is_bundle')
                        .eq('id', completedOrder.card_id)
                        .single();

                    const sc = soldCard as any;
                    if (sc && !sc.is_bundle && (sc.catalog_product_id || sc.catalog_soccer_id)) {
                        // tcgcsv category ids: 3 Pokémon EN / 85 Pokémon JP / 68 One Piece / 99 = soccer marker.
                        const categoryId = sc.catalog_soccer_id
                            ? 99
                            : sc.category === 'One Piece'
                                ? 68
                                : sc.language === 'jp' ? 85 : 3;

                        // Service role: vn_card_sales is read-only for clients
                        // (RLS), only the server records sales.
                        await service.from('vn_card_sales').insert({
                            catalog_product_id: sc.catalog_product_id,
                            catalog_soccer_id: sc.catalog_soccer_id,
                            card_id: sc.id,
                            category_id: categoryId,
                            card_number: sc.card_number,
                            language: sc.language,
                            grading_company: sc.grading_company || 'raw',
                            grade: sc.grade,
                            finish: sc.finish,
                            price: completedOrder.amount,
                        } as never);
                    }
                } catch (salesError) {
                    console.error('Could not record vn_card_sales:', salesError);
                }

                // Reputation: a confirmed order counts as one successful sale.
                // Never block the confirmation on it.
                if (!payoutResult?.replayed) {
                    const { error: statsError } = await service.rpc('update_seller_reputation' as never, {
                        p_seller_id: order.seller_id,
                        p_success: 1,
                        p_fault: 0,
                    } as never);
                    if (statsError) {
                        console.error('update_seller_reputation failed:', statsError);
                    }
                }

                return NextResponse.json({ success: true, status: 'completed' });
            }

            case 'dispute': {
                // Buyer disputes the order
                if (order.buyer_id !== user.id) {
                    return NextResponse.json({ error: 'Only buyer can dispute' }, { status: 403 });
                }
                const reason = typeof dispute_reason === 'string' ? dispute_reason.trim() : '';
                if (!reason) {
                    return NextResponse.json({ error: 'Dispute reason is required' }, { status: 400 });
                }
                const { error: disputeError } = await service.rpc(
                    'perform_marketplace_order_action' as never,
                    {
                        p_order_id: order_id,
                        p_action: 'open_dispute',
                        p_actor_id: user.id,
                        p_idempotency_key: idempotencyKey,
                        p_payload: { reason },
                    } as never,
                );
                if (disputeError) throw disputeError;

                return NextResponse.json({ success: true, status: 'disputed' });
            }

            case 'cancel': {
                const isOwner = order.buyer_id === user.id || order.seller_id === user.id;
                if (!isOwner) {
                    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
                }
                if (order.status === 'cancelled') {
                    return NextResponse.json({ success: true, status: 'cancelled', replayed: true });
                }
                return NextResponse.json({
                    error: 'A PayOS link that may still be payable cannot be cancelled locally. Cancel it in PayOS or wait for the webhook; use the dispute flow for paid orders.',
                    code: 'cancel_requires_provider_confirmation',
                }, { status: 409 });
            }

            default:
                return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Update order error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

export const GET = accountRoute(handleGET);
export const PATCH = accountRoute(handlePATCH);
