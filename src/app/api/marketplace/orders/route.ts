import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { cancelOrder as cancelGHNOrder } from '@/lib/ghn';
import { getCarrier, getTrackingUrl, getDeliveryDays } from '@/lib/shipping-carriers';
import { sendOrderShippedEmail } from '@/lib/mail';

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

        if (!order_id || !action) {
            return NextResponse.json({ error: 'order_id and action are required' }, { status: 400 });
        }

        // Get the order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order_id)
            .single();

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

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
                if (order.status !== 'paid') {
                    return NextResponse.json({ error: 'Order must be paid to ship' }, { status: 400 });
                }

                const carrierCode = typeof shipping_provider === 'string' ? shipping_provider.trim() : '';
                const trackingNo = typeof tracking_number === 'string' ? tracking_number.trim() : '';
                const carrier = getCarrier(carrierCode);
                if (!carrier) {
                    return NextResponse.json({ error: 'Vui lòng chọn đơn vị vận chuyển hợp lệ.', code: 'invalid_carrier' }, { status: 400 });
                }
                // Hand delivery ('self') may skip the tracking number; carriers require it.
                if (carrierCode !== 'self' && !trackingNo) {
                    return NextResponse.json({ error: 'Vui lòng nhập mã vận đơn.', code: 'missing_tracking' }, { status: 400 });
                }

                // Atomically claim the order (paid → shipping); a concurrent
                // 'cancel' can no longer refund an order that is being shipped.
                const { data: claimedOrder } = await supabase
                    .from('orders')
                    .update({ status: 'shipping', updated_at: new Date().toISOString() } as never)
                    .eq('id', order_id)
                    .eq('status', 'paid')
                    .select('id')
                    .maybeSingle();

                if (!claimedOrder) {
                    return NextResponse.json({
                        error: 'Đơn hàng vừa thay đổi trạng thái (có thể đã bị hủy hoặc đã ship).',
                        code: 'order_state_changed',
                    }, { status: 409 });
                }

                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        status: 'shipping',
                        tracking_number: trackingNo || null,
                        shipping_provider: carrierCode,
                        auto_complete_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                if (updateError) throw updateError;

                const trackingUrl = getTrackingUrl(carrierCode, trackingNo);

                // Notify buyer in-app
                await service.from('notifications').insert({
                    user_id: order.buyer_id,
                    type: 'order_shipped',
                    title: 'Đơn hàng đã được gửi!',
                    message: trackingNo
                        ? `Đơn đang được ${carrier.name} vận chuyển. Mã vận đơn: ${trackingNo}`
                        : 'Người bán đang giao trực tiếp đơn hàng của bạn.',
                    card_id: order.card_id,
                    order_id,
                } as never);

                // Catch-up email to the buyer (best-effort — never block shipping).
                if (trackingNo) {
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
                                cardName: (card as any)?.name || 'thẻ',
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
                });
            }

            case 'confirm_received': {
                if (order.buyer_id !== user.id) {
                    // The seller may confirm on a lazy buyer's behalf, but only
                    // after enough time for delivery has passed (est. max delivery
                    // + 3-day buffer from ship time) so they can't mark it early.
                    if (order.seller_id === user.id) {
                        const maxDays = getDeliveryDays(order.shipping_provider)?.max ?? 5;
                        const shippedAt = order.auto_complete_at
                            ? new Date(order.auto_complete_at).getTime() - 72 * 60 * 60 * 1000
                            : new Date(order.updated_at).getTime();
                        const allowedAt = shippedAt + (maxDays + 3) * 24 * 60 * 60 * 1000;
                        if (Date.now() < allowedAt) {
                            return NextResponse.json({
                                error: 'Chưa đủ thời gian để người bán xác nhận đã giao. Vui lòng chờ hết thời gian giao dự kiến.',
                                code: 'too_early',
                            }, { status: 400 });
                        }
                    } else {
                        return NextResponse.json({ error: 'Only buyer or seller can confirm' }, { status: 403 });
                    }
                }
                if (!['shipping', 'delivered'].includes(order.status)) {
                    return NextResponse.json({ error: 'Order must be shipping/delivered to confirm' }, { status: 400 });
                }

                // Atomically claim the completion: only the request that wins
                // this CAS pays the seller. A double-click, a retry, or the
                // 72h auto-release RPC (which guards on status='delivered')
                // can no longer produce a second payout.
                const { data: completedOrder } = await supabase
                    .from('orders')
                    .update({
                        status: 'completed',
                        buyer_confirmed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id)
                    .in('status', ['shipping', 'delivered'])
                    .select('id')
                    .maybeSingle();

                if (!completedOrder) {
                    return NextResponse.json({
                        error: 'Đơn hàng vừa thay đổi trạng thái, không thể xác nhận lại.',
                        code: 'order_state_changed',
                    }, { status: 409 });
                }

                // Release funds to seller. Fee model: seller gets the FULL
                // amount — the 5% platform fee is charged once, at withdrawal.
                // credit_wallet is an atomic SECURITY DEFINER RPC (balance
                // increment + ledger row in one transaction), service-role only.
                const sellerPayout = order.amount;
                const { error: payoutError } = await service.rpc('credit_wallet' as never, {
                    p_user_id: order.seller_id,
                    p_amount: sellerPayout,
                    p_type: 'marketplace_sale',
                    p_description: `Bán thẻ - Đơn #${order_id.substring(0, 8)}`,
                    p_reference_id: order_id,
                } as never);

                if (payoutError) {
                    // Put the order back so the payout can be retried (buyer
                    // re-confirms, or the 72h auto-release picks it up).
                    await supabase
                        .from('orders')
                        .update({ status: 'delivered', buyer_confirmed_at: null, updated_at: new Date().toISOString() } as never)
                        .eq('id', order_id)
                        .eq('status', 'completed');
                    throw payoutError;
                }

                // Notify seller
                await service.from('notifications').insert({
                    user_id: order.seller_id,
                    type: 'order_completed',
                    title: 'Đơn hàng hoàn tất!',
                    message: `Người mua đã xác nhận nhận hàng. ${sellerPayout.toLocaleString()}đ đã được cộng vào ví.`,
                    card_id: order.card_id,
                    order_id,
                } as never);

                // Record the completed sale for VN market pricing — only
                // standardized single-card listings (with a catalog key) count,
                // so open asking prices can never skew the aggregate. Never
                // let a pricing write break order confirmation.
                try {
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
                const { error: statsError } = await service.rpc('update_seller_reputation' as never, {
                    p_seller_id: order.seller_id,
                    p_success: 1,
                    p_fault: 0,
                } as never);
                if (statsError) {
                    console.error('update_seller_reputation failed:', statsError);
                }

                return NextResponse.json({ success: true, status: 'completed' });
            }

            case 'dispute': {
                // Buyer disputes the order
                if (order.buyer_id !== user.id) {
                    return NextResponse.json({ error: 'Only buyer can dispute' }, { status: 403 });
                }
                if (!['shipping', 'delivered'].includes(order.status)) {
                    return NextResponse.json({ error: 'Cannot dispute at this stage' }, { status: 400 });
                }

                await supabase
                    .from('orders')
                    .update({
                        status: 'disputed',
                        dispute_reason: dispute_reason || 'No reason provided',
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                // Notify seller
                await service.from('notifications').insert({
                    user_id: order.seller_id,
                    type: 'order_disputed',
                    title: 'Đơn hàng bị khiếu nại!',
                    message: `Người mua đã mở khiếu nại cho đơn hàng. Lý do: ${dispute_reason || 'Không rõ'}`,
                    card_id: order.card_id,
                    order_id,
                } as never);

                return NextResponse.json({ success: true, status: 'disputed' });
            }

            case 'cancel': {
                // Buyer or seller can cancel if status is pending_payment or paid
                const isOwner = order.buyer_id === user.id || order.seller_id === user.id;
                if (!isOwner) {
                    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
                }
                if (!['pending_payment', 'paid'].includes(order.status)) {
                    return NextResponse.json({ error: 'Cannot cancel at this stage' }, { status: 400 });
                }

                // Atomically claim the cancellation per prior status. Only the
                // request that wins a CAS refunds — two concurrent cancels, or
                // a cancel racing the seller's 'ship' claim, can't both act.
                const { data: cancelledPaid } = await supabase
                    .from('orders')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
                    .eq('id', order_id)
                    .eq('status', 'paid')
                    .select('id')
                    .maybeSingle();

                if (!cancelledPaid) {
                    const { data: cancelledPending } = await supabase
                        .from('orders')
                        .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
                        .eq('id', order_id)
                        .eq('status', 'pending_payment')
                        .select('id')
                        .maybeSingle();

                    if (!cancelledPending) {
                        return NextResponse.json({
                            error: 'Đơn hàng vừa thay đổi trạng thái, không thể hủy.',
                            code: 'order_state_changed',
                        }, { status: 409 });
                    }
                }

                // Refund a paid order to the buyer's CardVerse wallet — for
                // BOTH payment methods. A direct_payos payment already landed
                // in the platform account, so it is refunded as wallet balance
                // the buyer can spend or withdraw (previously it was silently
                // kept). credit_wallet is atomic, so a lost race above can't
                // double-refund.
                if (cancelledPaid) {
                    const { error: refundError } = await service.rpc('credit_wallet' as never, {
                        p_user_id: order.buyer_id,
                        p_amount: order.total_paid,
                        p_type: 'refund',
                        p_description: `Hoàn tiền - Đơn #${order_id.substring(0, 8)} đã hủy`,
                        p_reference_id: order_id,
                    } as never);

                    if (refundError) {
                        // Put the order back so the refund can be retried.
                        await supabase
                            .from('orders')
                            .update({ status: 'paid', updated_at: new Date().toISOString() } as never)
                            .eq('id', order_id)
                            .eq('status', 'cancelled');
                        throw refundError;
                    }

                    await service.from('notifications').insert({
                        user_id: order.buyer_id,
                        type: 'order_refunded',
                        title: 'Đơn hàng đã hủy - tiền đã hoàn',
                        message: `${Number(order.total_paid).toLocaleString()}đ đã được hoàn vào ví CardVerse của bạn.`,
                        card_id: order.card_id,
                        order_id,
                    } as never);
                }

                // Restore card to active (guarded: don't clobber a card that
                // was independently re-listed or re-sold in the meantime).
                await supabase
                    .from('cards')
                    .update({ status: 'active', reserved_until: null, updated_at: new Date().toISOString() } as never)
                    .eq('id', order.card_id)
                    .in('status', ['sold', 'in_transaction']);

                return NextResponse.json({ success: true, status: 'cancelled' });
            }

            default:
                return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Update order error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
