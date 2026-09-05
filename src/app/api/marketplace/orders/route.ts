import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isEvidenceVideoUrl } from '@/lib/evidence-video';
import { createShippingOrder } from '@/lib/ghn';
import { getCarrier, getTrackingUrl, getDeliveryDays } from '@/lib/shipping-carriers';
import { sendOrderShippedEmail } from '@/lib/mail';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';
import type { Database } from '@/lib/supabase/database.types';

type OrderRow = Database['public']['Tables']['orders']['Row'];

// GET: Fetch orders for current user
export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
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
        const role = searchParams.get('role') || 'buyer'; // 'buyer' | 'seller'
        const status = searchParams.get('status');

        let query = supabase
            .from('orders')
            .select(`
                *,
                card:cards(id, name, image_url, category, condition),
                buyer:profiles!orders_buyer_id_fkey(id, display_name, email, profile_image_url),
                seller:profiles!orders_seller_id_fkey(id, display_name, email, profile_image_url, seller_verified, seller_rating)
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

        return NextResponse.json({ orders: data || [] });
    } catch (error: any) {
        console.error('Get orders error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

// PATCH: Update order status
export async function PATCH(request: NextRequest) {
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
                let trackingNo = typeof tracking_number === 'string' ? tracking_number.trim() : '';
                const carrier = getCarrier(carrierCode);
                if (!carrier) {
                    return NextResponse.json({ error: 'Select a valid shipping carrier.', code: 'invalid_carrier' }, { status: 400 });
                }

                // ── GHN: the platform books the shipment under its own shop ──
                //
                // GHN delivers webhook events only to the account that registered
                // the endpoint, so a shipment the seller books in their own GHN
                // account can never tell us it was delivered — whatever code they
                // paste in. Booking it here is what makes `ghn_status` (and with
                // it escrow auto-release and the dispute verdict) work at all.
                //
                // The code is taken from GHN's response and never from the
                // request body: it is the join key the delivery webhook trusts.
                let ghnOrderCode: string | null = order.ghn_order_code || null;
                if (carrierCode === 'ghn' && !ghnOrderCode) {
                    const { data: sellerProfile } = await service
                        .from('profiles')
                        .select('default_shipping_name, default_shipping_phone, default_shipping_detail, default_shipping_ward_name, default_shipping_district_id, address_detail, address_ward_name, address_district_id, display_name, phone')
                        .eq('id', user.id)
                        .single();
                    const p = (sellerProfile || {}) as Record<string, any>;
                    const fromDistrictId = p.default_shipping_district_id || p.address_district_id;
                    const fromWardName = p.default_shipping_ward_name || p.address_ward_name;
                    const fromAddress = p.default_shipping_detail || p.address_detail;
                    const fromPhone = p.default_shipping_phone || p.phone;
                    if (!fromDistrictId || !fromWardName || !fromAddress || !fromPhone) {
                        return NextResponse.json({
                            error: 'Địa chỉ lấy hàng của bạn chưa đầy đủ nên chưa tạo được vận đơn GHN. Cập nhật địa chỉ trong phần Bán hàng, hoặc chọn đơn vị vận chuyển khác.',
                            code: 'seller_pickup_address_incomplete',
                        }, { status: 409 });
                    }
                    if (!order.to_district_id || !order.to_ward_code || !order.to_name || !order.to_phone) {
                        return NextResponse.json({
                            error: 'Địa chỉ nhận hàng của đơn này không đủ để tạo vận đơn GHN.',
                            code: 'buyer_address_incomplete',
                        }, { status: 409 });
                    }
                    try {
                        const created = await createShippingOrder({
                            client_order_code: String(order.id),
                            to_name: String(order.to_name),
                            to_phone: String(order.to_phone),
                            to_address: String(order.shipping_address || order.to_address_detail || ''),
                            to_ward_code: String(order.to_ward_code),
                            to_district_id: Number(order.to_district_id),
                            from_name: p.default_shipping_name || p.display_name || undefined,
                            from_phone: String(fromPhone),
                            from_address: String(fromAddress),
                            from_ward_name: String(fromWardName),
                            from_district_id: Number(fromDistrictId),
                            // The buyer already paid through escrow — nothing is
                            // collected on delivery.
                            cod_amount: 0,
                            insurance_value: Math.min(5_000_000, Math.max(0, Number(order.amount) || 0)),
                        });
                        ghnOrderCode = created.order_code;
                        trackingNo = created.order_code;
                    } catch (ghnError: any) {
                        return NextResponse.json({
                            error: `Không tạo được vận đơn GHN: ${ghnError?.message || 'lỗi không rõ'}. Bạn có thể thử lại hoặc chọn đơn vị vận chuyển khác.`,
                            code: 'ghn_order_creation_failed',
                        }, { status: 502 });
                    }
                } else if (ghnOrderCode) {
                    // A retry after the booking succeeded but the transition did
                    // not: reuse the code rather than booking a second parcel.
                    trackingNo = ghnOrderCode;
                }

                // Hand delivery ('self') may skip the tracking number; carriers require it.
                if (carrierCode !== 'self' && !trackingNo) {
                    return NextResponse.json({ error: 'Enter a tracking number.', code: 'missing_tracking' }, { status: 400 });
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
                            ghn_order_code: ghnOrderCode,
                            auto_complete_at: new Date(Date.now() + (estMaxDays + 3) * 24 * 60 * 60 * 1000).toISOString(),
                        },
                    } as never,
                );
                if (actionError) throw actionError;
                const actionResult = actionData as { replayed?: boolean } | null;

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
                    ghn_order_code: ghnOrderCode,
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
