import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isEvidenceVideoUrl } from '@/lib/evidence-video';
import { DEFAULT_TRACKING_LANG, registerCarrierTracking, trackableCarrier, fetchCarrierTrackingBatch } from '@/lib/carrier-tracking';
import { getCarrier, getTrackingUrl, getDeliveryDays } from '@/lib/shipping-carriers';
import { sendOrderShippedEmail } from '@/lib/mail';
import { notifyCarrierStatusChange } from '@/lib/carrier-notifications';
import { normalizeTrackingNumber, isValidTrackingNumber, TRACKING_MIN_LENGTH, TRACKING_MAX_LENGTH } from '@/lib/tracking-number';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';
import type { Database } from '@/lib/supabase/database.types';

type OrderRow = Database['public']['Tables']['orders']['Row'];

// GET: Fetch orders for current user
/**
 * How stale a carrier status has to be before a page load pays to refresh it.
 *
 * A parcel does not change status every minute, and every refresh is upstream
 * quota. Fifteen minutes keeps a watched order visibly current without turning
 * a reload into a billing event.
 */
const CARRIER_REFRESH_AFTER_MS = 15 * 60 * 1000;

/**
 * How long the refresh may spend sending catch-up mail before giving the page
 * back. Netlify kills the function at ten seconds and the query, the upstream
 * batch and the applies come first, so this is what is safely left over.
 */
const MAIL_BUDGET_MS = 4_000;

/**
 * Bring this user's in-flight parcels up to date with the carrier.
 *
 * Only their own orders, only ones with a trackable carrier and a number, and
 * only ones nothing has heard about recently. Statuses that did not change are
 * not written: apply_carrier_tracking_event returns `replayed` for those, but
 * not calling it at all is cheaper and keeps carrier_status_at meaning what it
 * says.
 *
 * Orders sharing a tracking number are skipped, for the same reason the
 * tracking-status route skips them: the RPC finds its order by number and takes
 * the newest match, so it cannot be aimed, and a Delivered written onto the
 * wrong order starts a 72h release clock nobody asked for.
 */
async function refreshCarrierStatuses(userId: string) {
    const service = createServiceSupabaseClient();
    const staleBefore = new Date(Date.now() - CARRIER_REFRESH_AFTER_MS).toISOString();

    const { data: rows } = await service
        .from('orders')
        .select('id, tracking_number, shipping_provider, carrier_status, carrier_status_at')
        .in('status', ['shipping', 'delivered'])
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .not('tracking_number', 'is', null)
        .or(`carrier_status_at.is.null,carrier_status_at.lt.${staleBefore}`)
        .limit(40);

    type CarrierRow = {
        id: string;
        tracking_number: string | null;
        shipping_provider: string | null;
        carrier_status: string | null;
    };
    const candidates = ((rows ?? []) as unknown as CarrierRow[]).filter(
        (row): row is CarrierRow & { tracking_number: string; shipping_provider: string } =>
            !!row.tracking_number && trackableCarrier(row.shipping_provider),
    );
    if (candidates.length === 0) return;

    // A number carried by more than one order cannot be reconciled safely.
    const seen = new Map<string, number>();
    for (const row of candidates) seen.set(row.tracking_number, (seen.get(row.tracking_number) ?? 0) + 1);

    const live = await fetchCarrierTrackingBatch(candidates.map((row) => ({
        carrier: row.shipping_provider,
        trackingNumber: row.tracking_number,
    })));
    if (live.size === 0) return;

    // Apply everything first — that is the part the page depends on, and it is
    // fast. Mail comes after, on whatever time is left.
    const applied: unknown[] = [];
    for (const row of candidates) {
        if ((seen.get(row.tracking_number) ?? 0) > 1) continue;
        const fresh = live.get(String(row.tracking_number).toUpperCase());
        if (!fresh || fresh.status === row.carrier_status) continue;
        const { data, error } = await service.rpc('apply_carrier_tracking_event' as never, {
            p_tracking_number: row.tracking_number,
            p_shipping_provider: row.shipping_provider,
            p_status: fresh.status,
            p_sub_status: fresh.subStatus,
        } as never);
        if (error) {
            console.error('[Tracking] Refresh apply failed:', error.message);
            continue;
        }
        applied.push(data);
    }

    // The same mail the webhook would have sent, for the changes it missed.
    //
    // Bounded rather than capped at a count: this runs inside a page load that
    // Netlify kills at ten seconds, and an SMTP round trip is seconds, not
    // milliseconds. Anything left when the budget runs out is named in the log
    // — its status is already saved, so the screen is right either way, and
    // only the notification is owed.
    const mailDeadline = Date.now() + MAIL_BUDGET_MS;
    for (let i = 0; i < applied.length; i += 1) {
        if (Date.now() >= mailDeadline) {
            const skipped = applied.slice(i)
                .map((r) => (r as { order_id?: string } | null)?.order_id)
                .filter(Boolean);
            console.warn(`[Tracking] Mail budget spent; no notification for: ${skipped.join(', ')}`);
            break;
        }
        await notifyCarrierStatusChange(service, applied[i] as never);
    }
}

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

        // Self-healing: pull the carrier's current status for parcels in flight.
        //
        // 17TRACK's webhook is the primary signal, but it is a push with no
        // signature, no delivery guarantee and no retry from us — a dropped one
        // is dropped for good, and until now nothing ever asked again. So the
        // page that displays the status also refreshes it, which is the moment
        // it matters and the moment someone is there to see the result.
        //
        // One batched upstream call for the whole page, only for rows that have
        // gone stale, and never blocking: a refresh that fails leaves the last
        // known status exactly where it was.
        try {
            await refreshCarrierStatuses(user.id);
        } catch (e) {
            console.error('refreshCarrierStatuses failed:', e);
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
            case 'ship': {
                // Manual fulfillment: the seller creates the order with their own
                // carrier and uploads the tracking number (no auto GHN order).
                if (order.seller_id !== user.id) {
                    return NextResponse.json({ error: 'Only seller can ship' }, { status: 403 });
                }
                const carrierCode = typeof shipping_provider === 'string' ? shipping_provider.trim() : '';
                const packingVideoUrl = evidenceVideoUrl(body.packing_video_url);
                const trackingNo = normalizeTrackingNumber(tracking_number);
                const carrier = getCarrier(carrierCode);
                if (!carrier) {
                    return NextResponse.json({ error: 'Select a valid shipping carrier.', code: 'invalid_carrier' }, { status: 400 });
                }

                // Hand delivery ('self') may skip the tracking number; carriers require it.
                if (carrierCode !== 'self' && !trackingNo) {
                    return NextResponse.json({ error: 'Enter a tracking number.', code: 'missing_tracking' }, { status: 400 });
                }
                // Nothing checked the shape before, and the table shows it: over
                // half the numbers on it are typing tests. A number that no
                // carrier issued cannot be registered or matched, so the order
                // silently never gets a delivery event and ends up in front of
                // an admin — a failure the seller could have been told about
                // here, while the field was still in front of them.
                if (trackingNo && !isValidTrackingNumber(trackingNo)) {
                    return NextResponse.json({
                        error: `Mã vận đơn không hợp lệ. Mã cần ${TRACKING_MIN_LENGTH}-${TRACKING_MAX_LENGTH} ký tự, chỉ gồm chữ, số và dấu gạch ngang.`,
                        code: 'invalid_tracking',
                    }, { status: 400 });
                }

                // Escalation deadline = est. max delivery + 3-day buffer from now.
                // If the buyer hasn't confirmed by then, the order escalates to
                // admin review (it is NOT auto-paid to the seller).
                const estMaxDays = getDeliveryDays(carrierCode)?.max ?? 5;
                const { data: actionData, error: actionError } = await service.rpc(
                    'perform_marketplace_order_action' as never,
                    {
                        p_order_id: order_id,
                        p_action: 'ship',
                        p_actor_id: user.id,
                        p_idempotency_key: idempotencyKey,
                        p_payload: {
                            tracking_number: trackingNo || null,
                            shipping_provider: carrierCode,
                            // Accepted at dispatch only — see the RPC.
                            packing_video_url: packingVideoUrl,
                            auto_complete_at: new Date(Date.now() + (estMaxDays + 3) * 24 * 60 * 60 * 1000).toISOString(),
                        },
                    } as never,
                );
                if (actionError) throw actionError;
                const actionResult = actionData as { replayed?: boolean } | null;

                // Start following the parcel. Best-effort on purpose: the goods
                // are already handed over, and an outage at the tracking service
                // must not be what stops a seller from shipping. Without it the
                // order simply keeps the 'unverified' delivery state, which the
                // dispute verdict already reports honestly.
                if (trackingNo && trackableCarrier(carrierCode) && !actionResult?.replayed) {
                    // The language is decided here and never again: a parcel
                    // is registered once, and that is the only moment the
                    // tracking service will accept one.
                    const registration = await registerCarrierTracking(carrierCode, trackingNo, DEFAULT_TRACKING_LANG);
                    if (!registration.registered) {
                        console.error(
                            `[Tracking] Could not register ${carrierCode} ${trackingNo}: ${registration.reason}`,
                        );
                    }
                }

                const trackingUrl = getTrackingUrl(carrierCode, trackingNo);

                // Catch-up email to the buyer (best-effort — never block shipping).
                if (trackingNo && !actionResult?.replayed) {
                    try {
                        const [{ data: buyer }, { data: card }] = await Promise.all([
                            service.from('profiles').select('email').eq('id', order.buyer_id).single(),
                            order.card_id
                                ? service.from('cards').select('name').eq('id', order.card_id).single()
                                : Promise.resolve({ data: null } as any),
                        ]);
                        const buyerEmail = (buyer as any)?.email;
                        if (buyerEmail) {
                            await sendOrderShippedEmail(buyerEmail, {
                                cardName: (card as any)?.name || 'card',
                                carrierName: carrier.name,
                                trackingNumber: trackingNo,
                                trackingUrl,
                            });
                        }
                    } catch (mailErr) {
                        console.error('Order shipped email failed:', mailErr);
                    }
                }

                return NextResponse.json({
                    success: true,
                    status: 'shipping',
                    tracking_number: trackingNo,
                    shipping_provider: carrierCode,
                    packing_video_url: packingVideoUrl,
                });
            }

            case 'submit_unboxing_video': {
                // The buyer's side of the evidence rule. Optional, write-once,
                // and only while the confirmation window is open — the RPC
                // enforces all three, so a late or second upload cannot land
                // here even if the button is still on screen.
                if (order.buyer_id !== user.id) {
                    return NextResponse.json({ error: 'Only buyer can submit an unboxing video' }, { status: 403 });
                }
                const videoUrl = evidenceVideoUrl(body.video_url);
                if (!videoUrl) {
                    return NextResponse.json(
                        { error: 'A valid uploaded video is required.', code: 'invalid_evidence_video' },
                        { status: 400 },
                    );
                }
                const { error: videoError } = await service.rpc(
                    'perform_marketplace_order_action' as never,
                    {
                        p_order_id: order_id,
                        p_action: 'submit_unboxing_video',
                        p_actor_id: user.id,
                        p_idempotency_key: idempotencyKey,
                        p_payload: { video_url: videoUrl },
                    } as never,
                );
                if (videoError) {
                    const code = ['unboxing_video_already_submitted', 'unboxing_video_window_closed', 'unboxing_video_not_acceptable']
                        .find(value => videoError.message.includes(value));
                    if (code) return NextResponse.json({ error: code, code }, { status: 409 });
                    throw videoError;
                }

                return NextResponse.json({ success: true, video_url: videoUrl });
            }

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
