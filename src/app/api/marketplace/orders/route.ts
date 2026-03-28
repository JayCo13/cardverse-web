import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
                // Seller ships the order
                if (order.seller_id !== user.id) {
                    return NextResponse.json({ error: 'Only seller can ship' }, { status: 403 });
                }
                if (order.status !== 'paid') {
                    return NextResponse.json({ error: 'Order must be paid to ship' }, { status: 400 });
                }

                const { error: updateError } = await supabase
                    .from('orders')
                    .update({
                        status: 'shipping',
                        tracking_number: tracking_number || null,
                        shipping_provider: shipping_provider || null,
                        auto_complete_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72h from now
                        updated_at: new Date().toISOString(),
                    } as never)
                    .eq('id', order_id);

                if (updateError) throw updateError;

                // Notify buyer
                await supabase.from('notifications').insert({
                    user_id: order.buyer_id,
                    type: 'order_shipped',
                    title: 'Đơn hàng đã được gửi!',
                    message: `Đơn hàng của bạn đang được vận chuyển${tracking_number ? `. Mã theo dõi: ${tracking_number}` : ''}.`,
                    card_id: order.card_id,
                } as never);

                return NextResponse.json({ success: true, status: 'shipping' });
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
