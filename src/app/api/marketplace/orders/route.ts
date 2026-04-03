import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createShippingOrder, cancelOrder as cancelGHNOrder } from '@/lib/ghn';

// GET: Fetch orders for current user
export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
                        insurance_value: Math.min(order.amount || 0, 5000000),
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
                await supabase.from('notifications').insert({
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

                // Update order to completed
                await supabase
                    .from('orders')
                    .update({
                        status: 'completed',
                        buyer_confirmed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                // Release funds to seller (amount - platform_fee)
                const sellerPayout = order.amount - order.platform_fee;

                // Get or create seller wallet
                let { data: sellerWallet } = await supabase
                    .from('wallets')
                    .select('*')
                    .eq('user_id', order.seller_id)
                    .single();

                if (!sellerWallet) {
                    const { data: newWallet } = await supabase
                        .from('wallets')
                        .insert({ user_id: order.seller_id } as never)
                        .select()
                        .single();
                    sellerWallet = newWallet;
                }

                if (sellerWallet) {
                    const newBalance = sellerWallet.available_balance + sellerPayout;
                    await supabase
                        .from('wallets')
                        .update({
                            available_balance: newBalance,
                            updated_at: new Date().toISOString(),
                        } as never)
                        .eq('user_id', order.seller_id);

                    await supabase.from('wallet_transactions').insert({
                        wallet_id: sellerWallet.id,
                        user_id: order.seller_id,
                        type: 'marketplace_sale',
                        amount: sellerPayout,
                        balance_after: newBalance,
                        description: `Bán thẻ - Đơn #${order_id.substring(0, 8)}`,
                        reference_id: order_id,
                    } as never);
                }

                // Notify seller
                await supabase.from('notifications').insert({
                    user_id: order.seller_id,
                    type: 'order_completed',
                    title: 'Đơn hàng hoàn tất!',
                    message: `Người mua đã xác nhận nhận hàng. ${sellerPayout.toLocaleString()}đ đã được cộng vào ví.`,
                    card_id: order.card_id,
                } as never);

                // Update seller stats
                await supabase.rpc('increment_seller_stats' as never, {
                    p_seller_id: order.seller_id,
                } as never).catch(() => {
                    // If RPC doesn't exist yet, manual update
                    supabase
                        .from('profiles')
                        .update({
                            total_transactions: (supabase as any).raw?.('total_transactions + 1') || 1,
                            completed_transactions: (supabase as any).raw?.('completed_transactions + 1') || 1,
                        } as never)
                        .eq('id', order.seller_id);
                });

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
                await supabase.from('notifications').insert({
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

                await supabase
                    .from('orders')
                    .update({
                        status: 'cancelled',
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                // Refund buyer if paid by wallet
                if (order.status === 'paid' && order.payment_method === 'wallet') {
                    const { data: buyerWallet } = await supabase
                        .from('wallets')
                        .select('*')
                        .eq('user_id', order.buyer_id)
                        .single();

                    if (buyerWallet) {
                        const newBalance = buyerWallet.available_balance + order.total_paid;
                        await supabase
                            .from('wallets')
                            .update({
                                available_balance: newBalance,
                                updated_at: new Date().toISOString(),
                            } as never)
                            .eq('user_id', order.buyer_id);

                        await supabase.from('wallet_transactions').insert({
                            wallet_id: buyerWallet.id,
                            user_id: order.buyer_id,
                            type: 'escrow_release',
                            amount: order.total_paid,
                            balance_after: newBalance,
                            description: `Hoàn tiền - Đơn #${order_id.substring(0, 8)} đã hủy`,
                            reference_id: order_id,
                        } as never);
                    }
                }

                // Restore card to active
                await supabase
                    .from('cards')
                    .update({ status: 'active', updated_at: new Date().toISOString() } as never)
                    .eq('id', order.card_id);

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
