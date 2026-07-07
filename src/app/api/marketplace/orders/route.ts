import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { createShippingOrder, cancelOrder as cancelGHNOrder } from '@/lib/ghn';

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
                // Seller ships the order — auto-create GHN shipping order
                if (order.seller_id !== user.id) {
                    return NextResponse.json({ error: 'Only seller can ship' }, { status: 403 });
                }
                if (order.status !== 'paid') {
                    return NextResponse.json({ error: 'Order must be paid to ship' }, { status: 400 });
                }

                // Get seller's address from profile
                const { data: sellerProfile } = await supabase
                    .from('profiles')
                    .select('address_district_id, address_ward_code, address_ward_name, address_detail, address_district_name, address_province_name, display_name, phone_number')
                    .eq('id', user.id)
                    .single();

                if (!sellerProfile?.address_district_id || !sellerProfile?.address_ward_code) {
                    return NextResponse.json({
                        error: 'Vui lòng cập nhật địa chỉ gửi hàng trong hồ sơ trước khi giao hàng.',
                        code: 'MISSING_SELLER_ADDRESS',
                    }, { status: 400 });
                }

                // Buyer address from order
                if (!order.to_district_id || !order.to_ward_code) {
                    return NextResponse.json({
                        error: 'Đơn hàng thiếu thông tin địa chỉ người nhận.',
                    }, { status: 400 });
                }

                // Atomically claim the order (paid → shipping) BEFORE calling
                // GHN. A concurrent 'cancel' can no longer refund an order
                // whose shipment is being created — only one of the two
                // guarded updates wins.
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

                const revertShipClaim = async () => {
                    await supabase
                        .from('orders')
                        .update({ status: 'paid', updated_at: new Date().toISOString() } as never)
                        .eq('id', order_id)
                        .eq('status', 'shipping');
                };

                let ghnOrderCode: string | null = null;
                let ghnExpectedDelivery: string | null = null;
                let ghnFee: number | null = null;
                let finalTrackingNumber: string | null = tracking_number || null;

                try {
                    // Create GHN shipping order
                    const ghnResult = await createShippingOrder({
                        to_name: order.to_name || 'Người nhận',
                        to_phone: order.to_phone || '',
                        to_address: `${order.to_address_detail || ''}, ${order.to_ward_name || ''}, ${order.to_district_name || ''}`,
                        to_ward_code: order.to_ward_code,
                        to_district_id: order.to_district_id,
                        from_name: sellerProfile.display_name || 'Người gửi',
                        from_phone: sellerProfile.phone_number || '',
                        from_address: `${sellerProfile.address_detail || ''}, ${sellerProfile.address_ward_name || ''}, ${sellerProfile.address_district_name || ''}`,
                        from_ward_name: sellerProfile.address_ward_name || '',
                        from_district_id: sellerProfile.address_district_id,
                        client_order_code: order_id.substring(0, 20),
                        insurance_value: Math.min(order.amount || 0, 500000), // cap matches checkout quote; CardVerse escrow covers the rest
                        note: 'Thẻ bài - Xử lý cẩn thận',
                        required_note: 'CHOTHUHANG',
                    });

                    ghnOrderCode = ghnResult.order_code;
                    ghnExpectedDelivery = ghnResult.expected_delivery_time;
                    ghnFee = ghnResult.total_fee;
                    finalTrackingNumber = ghnResult.order_code; // GHN order code IS the tracking number
                } catch (ghnError: any) {
                    console.error('GHN create order failed:', ghnError);
                    // Fallback: still allow shipping with manual tracking
                    if (!tracking_number) {
                        await revertShipClaim();
                        return NextResponse.json({
                            error: `Không thể tạo đơn GHN: ${ghnError.message}. Vui lòng thử lại hoặc nhập mã vận đơn thủ công.`,
                            code: 'GHN_ERROR',
                        }, { status: 500 });
                    }
                }

                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        status: 'shipping',
                        tracking_number: finalTrackingNumber,
                        shipping_provider: ghnOrderCode ? 'GHN' : (shipping_provider || 'Manual'),
                        ghn_order_code: ghnOrderCode,
                        ghn_expected_delivery: ghnExpectedDelivery,
                        ghn_shipping_fee: ghnFee,
                        ghn_status: ghnOrderCode ? 'ready_to_pick' : null,
                        auto_complete_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                if (updateError) throw updateError;

                // Notify buyer
                await service.from('notifications').insert({
                    user_id: order.buyer_id,
                    type: 'order_shipped',
                    title: 'Đơn hàng đã được gửi!',
                    message: ghnOrderCode
                        ? `Đơn hàng đang được GHN vận chuyển. Mã theo dõi: ${ghnOrderCode}`
                        : `Đơn hàng đang được vận chuyển${finalTrackingNumber ? `. Mã theo dõi: ${finalTrackingNumber}` : ''}.`,
                    card_id: order.card_id,
                } as never);

                return NextResponse.json({
                    success: true,
                    status: 'shipping',
                    ghn_order_code: ghnOrderCode,
                    tracking_number: finalTrackingNumber,
                });
            }

            case 'confirm_received': {
                // Buyer confirms receipt
                if (order.buyer_id !== user.id) {
                    return NextResponse.json({ error: 'Only buyer can confirm' }, { status: 403 });
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

                // Update seller stats — never block the confirmation on it.
                // (The old fallback wrote the literal 1 over the counters via
                // a nonexistent supabase.raw() API; removed.)
                const { error: statsError } = await supabase.rpc('increment_seller_stats' as never, {
                    p_seller_id: order.seller_id,
                } as never);
                if (statsError) {
                    console.error('increment_seller_stats failed:', statsError);
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
