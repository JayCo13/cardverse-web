import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    DEPOSIT_PAYMENT_TYPE,
    getPayOS,
    MARKETPLACE_ORDER_PAYMENT_TYPE,
    PACKAGES,
    type PackageType,
    type PaymentOrderType,
    SUBSCRIPTION_PACKAGE_TYPES,
} from '@/lib/payos';

function getServiceClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

function isSubscriptionPackageType(type: PaymentOrderType): type is PackageType {
    return SUBSCRIPTION_PACKAGE_TYPES.includes(type as PackageType);
}

async function cancelMarketplaceOrder(
    supabase: ReturnType<typeof getServiceClient>,
    paymentOrderId: string
) {
    const { data: marketplaceOrders } = await supabase
        .from('orders')
        .select('id, card_id, status')
        .eq('payment_order_id', paymentOrderId);

    const pendingOrders = (marketplaceOrders || []).filter(order => order.status === 'pending_payment');
    if (pendingOrders.length === 0) {
        return;
    }

    await supabase
        .from('orders')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
        } as never)
        .in('id', pendingOrders.map(order => order.id))
        .eq('status', 'pending_payment');

    await supabase
        .from('cards')
        .update({
            status: 'active',
            reserved_until: null,
            updated_at: new Date().toISOString(),
        } as never)
        .in('id', pendingOrders.map(order => order.card_id))
        .eq('status', 'in_transaction');
}

async function completeWalletDeposit(
    supabase: ReturnType<typeof getServiceClient>,
    userId: string,
    amount: number,
    referenceId: string
) {
    let { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (!wallet) {
        const { data: createdWallet } = await supabase
            .from('wallets')
            .insert({ user_id: userId } as never)
            .select()
            .single();
        wallet = createdWallet;
    }

    if (!wallet) {
        throw new Error('Wallet not found');
    }

    const nextBalance = (wallet.available_balance || 0) + amount;
    const nextTotalDeposited = (wallet.total_deposited || 0) + amount;

    await supabase
        .from('wallets')
        .update({
            available_balance: nextBalance,
            total_deposited: nextTotalDeposited,
            updated_at: new Date().toISOString(),
        } as never)
        .eq('user_id', userId);

    await supabase.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        user_id: userId,
        type: 'deposit',
        amount,
        balance_after: nextBalance,
        description: 'Nạp ví qua PayOS',
        reference_id: referenceId,
    } as never);
}

async function notifySellerOfSale(
    supabase: ReturnType<typeof getServiceClient>,
    sellerId: string,
    cardId: string
) {
    await supabase.from('notifications').insert({
        user_id: sellerId,
        type: 'order_new',
        title: 'Đơn hàng mới!',
        message: 'Người mua đã thanh toán thành công. Vui lòng chuẩn bị giao hàng.',
        card_id: cardId,
    } as never);
}

async function completeMarketplaceOrderPayment(
    supabase: ReturnType<typeof getServiceClient>,
    paymentOrderId: string
) {
    const { data: marketplaceOrders } = await supabase
        .from('orders')
        .select('id, card_id, seller_id, buyer_id, status')
        .eq('payment_order_id', paymentOrderId);

    if (!marketplaceOrders || marketplaceOrders.length === 0) {
        return;
    }
    const now = new Date().toISOString();

    // Normal path: the reservation is still alive → finalize the sale.
    const pendingOrders = marketplaceOrders.filter(order => order.status === 'pending_payment');
    if (pendingOrders.length > 0) {
        await supabase
            .from('orders')
            .update({ status: 'paid', updated_at: now } as never)
            .in('id', pendingOrders.map(order => order.id))
            .eq('status', 'pending_payment');

        // Lock the card as sold and clear the reservation hold.
        await supabase
            .from('cards')
            .update({ status: 'sold', reserved_until: null, updated_at: now } as never)
            .in('id', pendingOrders.map(order => order.card_id));

        // If this order came from an accepted offer, close out its transaction
        // (offer-based transactions are the only active ones on this card).
        await supabase
            .from('transactions')
            .update({ status: 'completed', completed_at: now } as never)
            .in('card_id', pendingOrders.map(order => order.card_id))
            .eq('status', 'active');

        for (const order of pendingOrders) {
            await notifySellerOfSale(supabase, order.seller_id, order.card_id);
        }
        return;
    }

    // Edge case: the reservation expired and the order was auto-cancelled just
    // before this payment landed. Re-acquire the card if it's still free;
    // otherwise it was taken by someone else → flag the buyer for a refund.
    const cancelledOrders = marketplaceOrders.filter(order => order.status === 'cancelled');
    for (const marketplaceOrder of cancelledOrders) {
        const { data: reacquired } = await supabase
            .from('cards')
            .update({ status: 'sold', reserved_until: null, updated_at: now } as never)
            .eq('id', marketplaceOrder.card_id)
            .eq('status', 'active')
            .select('id')
            .maybeSingle();

        if (reacquired) {
            await supabase
                .from('orders')
                .update({ status: 'paid', updated_at: now } as never)
                .eq('id', marketplaceOrder.id);
            await supabase
                .from('transactions')
                .update({ status: 'completed', completed_at: now } as never)
                .eq('card_id', marketplaceOrder.card_id)
                .eq('status', 'active');
            await notifySellerOfSale(supabase, marketplaceOrder.seller_id, marketplaceOrder.card_id);
        } else {
            await supabase.from('notifications').insert({
                user_id: marketplaceOrder.buyer_id,
                type: 'refund_needed',
                title: 'Thanh toán cần hoàn tiền',
                message: 'Thẻ đã không còn khả dụng khi thanh toán hoàn tất. Vui lòng liên hệ hỗ trợ để được hoàn tiền.',
                card_id: marketplaceOrder.card_id,
            } as never);
        }
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // PayOS uses orderCode=123 for webhook verification. Never bypass
        // signature validation in production; local/test environments must
        // opt in explicitly as well.
        if (
            process.env.NODE_ENV !== 'production' &&
            process.env.PAYOS_ALLOW_TEST_WEBHOOK_BYPASS === 'true' &&
            body?.data?.orderCode === 123
        ) {
            return NextResponse.json({ success: true });
        }

        let webhookData;
        try {
            webhookData = await getPayOS().webhooks.verify(body);
        } catch (err: any) {
            console.error('[SECURITY] Invalid PayOS webhook signature:', err?.message || err);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        const supabase = getServiceClient();

        const { data: order, error: orderError } = await supabase
            .from('payment_orders')
            .select('*')
            .eq('order_code', webhookData.orderCode)
            .single();

        if (orderError || !order) {
            console.error('[SECURITY] Unknown orderCode received:', webhookData.orderCode);
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const orderType = order.package_type as PaymentOrderType;

        if (order.status === 'paid') {
            return NextResponse.json({ success: true });
        }

        if (webhookData.code !== '00') {
            await supabase
                .from('payment_orders')
                .update({ status: 'cancelled' })
                .eq('order_code', webhookData.orderCode);

            if (orderType === MARKETPLACE_ORDER_PAYMENT_TYPE) {
                await cancelMarketplaceOrder(supabase, order.id);
            }

            return NextResponse.json({ success: true });
        }

        const expectedAmount = isSubscriptionPackageType(orderType)
            ? PACKAGES[orderType].amount
            : order.amount;

        if (webhookData.amount !== expectedAmount) {
            console.error(
                `[SECURITY] Amount mismatch! Expected ${expectedAmount}, got ${webhookData.amount} for order ${webhookData.orderCode}`
            );

            await supabase
                .from('payment_orders')
                .update({ status: 'fraud_suspected' })
                .eq('order_code', webhookData.orderCode);

            if (orderType === MARKETPLACE_ORDER_PAYMENT_TYPE) {
                await cancelMarketplaceOrder(supabase, order.id);
            }

            return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
        }

        const { data: updatedOrder, error: updateError } = await supabase
            .from('payment_orders')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('order_code', webhookData.orderCode)
            .eq('status', 'pending')
            .select('id')
            .single();

        if (updateError || !updatedOrder) {
            console.log('[INFO] Order already processed (race condition prevented):', webhookData.orderCode);
            return NextResponse.json({ success: true });
        }

        const userId = order.user_id;

        if (orderType === DEPOSIT_PAYMENT_TYPE) {
            await completeWalletDeposit(supabase, userId, order.amount, String(webhookData.orderCode));
        } else if (orderType === MARKETPLACE_ORDER_PAYMENT_TYPE) {
            await completeMarketplaceOrderPayment(supabase, order.id);
        } else if (orderType === 'day_pass') {
            await supabase.from('user_subscriptions').insert({
                user_id: userId,
                package_type: 'day_pass',
                status: 'active',
                starts_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                payment_reference: String(webhookData.orderCode),
            });
        } else if (orderType === 'credit_pack') {
            const { data: existingPack } = await supabase
                .from('user_subscriptions')
                .select('id, scan_credits_remaining')
                .eq('user_id', userId)
                .eq('package_type', 'credit_pack')
                .eq('status', 'active')
                .gt('scan_credits_remaining', 0)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (existingPack) {
                const newCredits = (existingPack.scan_credits_remaining || 0) + 100;
                await supabase
                    .from('user_subscriptions')
                    .update({ scan_credits_remaining: newCredits })
                    .eq('id', existingPack.id)
                    .eq('scan_credits_remaining', existingPack.scan_credits_remaining);
            } else {
                await supabase.from('user_subscriptions').insert({
                    user_id: userId,
                    package_type: 'credit_pack',
                    status: 'active',
                    scan_credits_remaining: 100,
                    payment_reference: String(webhookData.orderCode),
                });
            }
        } else if (orderType === 'vip_pro') {
            const { data: existingVip } = await supabase
                .from('user_subscriptions')
                .select('id, expires_at')
                .eq('user_id', userId)
                .eq('package_type', 'vip_pro')
                .eq('status', 'active')
                .gte('expires_at', new Date().toISOString())
                .single();

            if (existingVip) {
                const currentExpiry = new Date(existingVip.expires_at);
                const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);
                await supabase
                    .from('user_subscriptions')
                    .update({ expires_at: newExpiry.toISOString() })
                    .eq('id', existingVip.id);
            } else {
                await supabase.from('user_subscriptions').insert({
                    user_id: userId,
                    package_type: 'vip_pro',
                    status: 'active',
                    starts_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    payment_reference: String(webhookData.orderCode),
                });
            }
        }

        if (isSubscriptionPackageType(orderType)) {
            const { data: wallet } = await supabase
                .from('wallets')
                .select('id, available_balance')
                .eq('user_id', userId)
                .single();

            if (wallet) {
                await supabase.from('wallet_transactions').insert({
                    wallet_id: wallet.id,
                    user_id: userId,
                    type: orderType === 'vip_pro' ? 'vip_subscription' : 'scan_purchase',
                    amount: -order.amount,
                    balance_after: wallet.available_balance,
                    description: `Purchased ${orderType.replace('_', ' ')}`,
                    reference_id: String(webhookData.orderCode),
                });
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[ERROR] PayOS webhook error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
