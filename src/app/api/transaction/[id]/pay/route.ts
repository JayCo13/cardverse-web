import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS, MARKETPLACE_ORDER_PAYMENT_TYPE } from '@/lib/payos';
import { randomInt } from 'crypto';

// Escrow checkout for an accepted offer. Mirrors /api/marketplace/buy but is
// driven by an existing transaction (card already in_transaction, buyer fixed,
// price = the agreed offer price). Money is held by the platform until the
// order pipeline releases it on delivery — same anti-scam model as Buy.
//
// Fee model: the 5% platform fee is charged once, at withdrawal — orders carry
// platform_fee = 0 and the seller is credited the full amount on completion.

const RESERVATION_MINUTES = 15; // How long a PayOS checkout holds the card.

type TransactionRow = {
    id: string;
    card_id: string;
    seller_id: string;
    buyer_id: string;
    offer_id: string | null;
    price: number;
    status: string;
    expires_at: string;
};

type WalletRow = { id: string; available_balance: number };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: transactionId } = await params;
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            payment_method, shipping_address,
            shipping_fee: clientShippingFee,
            to_name, to_phone,
            to_district_id, to_district_name,
            to_province_id, to_province_name,
            to_ward_code, to_ward_name,
            to_address_detail,
        } = body;

        const shippingFee = Math.max(0, parseInt(clientShippingFee) || 0);

        if (!payment_method || !['wallet', 'direct_payos'].includes(payment_method)) {
            return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
        }

        if (
            !to_name || !to_phone || !to_district_id || !to_district_name ||
            !to_province_id || !to_province_name || !to_ward_code || !to_ward_name || !to_address_detail
        ) {
            return NextResponse.json({ error: 'Shipping address is incomplete' }, { status: 400 });
        }

        // Load and validate the transaction.
        const { data: transaction, error: txError } = await supabase
            .from('transactions')
            .select('id, card_id, seller_id, buyer_id, offer_id, price, status, expires_at')
            .eq('id', transactionId)
            .single<TransactionRow>();

        if (txError || !transaction) {
            return NextResponse.json({ error: 'Giao dịch không tồn tại.', code: 'transaction_not_found' }, { status: 404 });
        }

        if (transaction.buyer_id !== user.id) {
            return NextResponse.json({ error: 'Chỉ người mua mới có thể thanh toán giao dịch này.' }, { status: 403 });
        }

        if (transaction.status !== 'active') {
            return NextResponse.json(
                { error: 'Giao dịch không còn ở trạng thái chờ thanh toán.', code: 'transaction_not_active' },
                { status: 409 },
            );
        }

        if (new Date(transaction.expires_at).getTime() <= Date.now()) {
            return NextResponse.json(
                { error: 'Giao dịch đã hết hạn. Vui lòng thương lượng lại với người bán.', code: 'transaction_expired' },
                { status: 409 },
            );
        }

        // Card must still be held for this transaction (not already sold).
        const { data: card, error: cardError } = await supabase
            .from('cards')
            .select('id, name, status')
            .eq('id', transaction.card_id)
            .single<{ id: string; name: string; status: string }>();

        if (cardError || !card) {
            return NextResponse.json({ error: 'Không tìm thấy thẻ.', code: 'card_not_found' }, { status: 404 });
        }

        if (card.status === 'sold') {
            return NextResponse.json(
                { error: 'Thẻ này đã được thanh toán hoặc bán cho người khác.', code: 'card_unavailable' },
                { status: 409 },
            );
        }

        const amount = Number(transaction.price);
        const platformFee = 0; // fee is charged at withdrawal, not at sale
        const totalPaid = amount + shippingFee;

        // Wallet pre-check (no mutation) before doing anything irreversible.
        let walletRow: WalletRow | null = null;
        if (payment_method === 'wallet') {
            const { data: wallet, error: walletError } = await supabase
                .from('wallets')
                .select('*')
                .eq('user_id', user.id)
                .single<WalletRow>();

            if (walletError || !wallet) {
                return NextResponse.json({ error: 'Không tìm thấy ví. Vui lòng nạp tiền trước.' }, { status: 400 });
            }
            if (wallet.available_balance < totalPaid) {
                return NextResponse.json({
                    error: 'Số dư ví không đủ',
                    available: wallet.available_balance,
                    required: totalPaid,
                }, { status: 400 });
            }
            walletRow = wallet;
        }

        // Re-assert the hold on the card (keep it in_transaction with a fresh
        // reservation window) so a PayOS abandonment can be released later.
        const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);

        const orderShipping = {
            shipping_address: shipping_address || null,
            to_name: to_name || null,
            to_phone: to_phone || null,
            to_district_id: to_district_id || null,
            to_district_name: to_district_name || null,
            to_province_id: to_province_id || null,
            to_province_name: to_province_name || null,
            to_ward_code: to_ward_code || null,
            to_ward_name: to_ward_name || null,
            to_address_detail: to_address_detail || null,
        };

        if (payment_method === 'wallet') {
            // ── WALLET PAYMENT (synchronous escrow) ──
            // Wallet writes are RLS-locked; mutate through the service client
            // with an optimistic lock on the balance we just read.
            const service = createServiceSupabaseClient();
            const wallet = walletRow!;
            const newBalance = wallet.available_balance - totalPaid;

            const { data: debited, error: deductError } = await service
                .from('wallets')
                .update({ available_balance: newBalance, updated_at: new Date().toISOString() } as never)
                .eq('user_id', user.id)
                .eq('available_balance', wallet.available_balance)
                .select('id')
                .maybeSingle();
            if (deductError || !debited) {
                return NextResponse.json(
                    { error: 'Số dư vừa thay đổi, vui lòng thử lại.', code: 'balance_changed' },
                    { status: 409 },
                );
            }

            await service.from('wallet_transactions').insert({
                wallet_id: wallet.id,
                user_id: user.id,
                type: 'marketplace_buy',
                amount: -totalPaid,
                balance_after: newBalance,
                description: `Mua thẻ (đề nghị): ${card.name}`,
                reference_id: transaction.card_id,
            } as never);

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    card_id: transaction.card_id,
                    seller_id: transaction.seller_id,
                    buyer_id: user.id,
                    offer_id: transaction.offer_id,
                    amount,
                    platform_fee: platformFee,
                    total_paid: totalPaid,
                    shipping_fee: shippingFee,
                    payment_method: 'wallet',
                    status: 'paid',
                    ...orderShipping,
                } as never)
                .select()
                .single();

            if (orderError) {
                // Refund the wallet if the order couldn't be created.
                await service
                    .from('wallets')
                    .update({ available_balance: wallet.available_balance, updated_at: new Date().toISOString() } as never)
                    .eq('user_id', user.id)
                    .eq('available_balance', newBalance);
                throw orderError;
            }

            await supabase
                .from('cards')
                .update({ status: 'sold', reserved_until: null, updated_at: new Date().toISOString() } as never)
                .eq('id', transaction.card_id);

            await supabase
                .from('transactions')
                .update({ status: 'completed', completed_at: new Date().toISOString() } as never)
                .eq('id', transactionId)
                .eq('status', 'active');

            await createServiceSupabaseClient().from('notifications').insert({
                user_id: transaction.seller_id,
                type: 'order_new',
                title: 'Đơn hàng mới!',
                message: `Thẻ "${card.name}" đã được thanh toán. Vui lòng giao hàng.`,
                card_id: transaction.card_id,
                transaction_id: transactionId,
            } as never);

            return NextResponse.json({ success: true, order, payment_method: 'wallet' });
        }

        // ── DIRECT PAYOS PAYMENT ──
        await supabase
            .from('cards')
            .update({ status: 'in_transaction', reserved_until: reservedUntil.toISOString(), updated_at: new Date().toISOString() } as never)
            .eq('id', transaction.card_id);

        const orderCode = randomInt(10_000_000, 99_999_999);

        const { data: paymentOrder, error: poError } = await supabase
            .from('payment_orders')
            .insert({
                user_id: user.id,
                order_code: orderCode,
                package_type: MARKETPLACE_ORDER_PAYMENT_TYPE,
                amount: totalPaid,
                status: 'pending',
            } as never)
            .select()
            .single<{ id: string }>();

        if (poError || !paymentOrder) throw (poError || new Error('Could not create payment order'));

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert({
                card_id: transaction.card_id,
                seller_id: transaction.seller_id,
                buyer_id: user.id,
                offer_id: transaction.offer_id,
                amount,
                platform_fee: platformFee,
                total_paid: totalPaid,
                shipping_fee: shippingFee,
                payment_method: 'direct_payos',
                payment_order_id: paymentOrder.id,
                status: 'pending_payment',
                ...orderShipping,
            } as never)
            .select()
            .single();

        if (orderError) throw orderError;

        const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const paymentLink = await getPayOS().paymentRequests.create({
            orderCode,
            amount: totalPaid,
            description: `Mua the ${card.name.substring(0, 20)}`,
            expiredAt: Math.floor(reservedUntil.getTime() / 1000),
            cancelUrl: `${origin}/orders?status=cancelled`,
            returnUrl: `${origin}/orders?status=success`,
            items: [{ name: card.name.substring(0, 50), quantity: 1, price: totalPaid }],
        });

        await supabase
            .from('payment_orders')
            .update({
                payos_payment_link_id: paymentLink.paymentLinkId,
                payos_checkout_url: paymentLink.checkoutUrl,
            } as never)
            .eq('order_code', orderCode);

        return NextResponse.json({
            success: true,
            order,
            payment_method: 'direct_payos',
            checkoutUrl: paymentLink.checkoutUrl,
            qrCode: paymentLink.qrCode,
            orderCode,
        });
    } catch (error: any) {
        console.error('Transaction pay error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
