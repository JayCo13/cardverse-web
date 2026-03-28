import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPayOS } from '@/lib/payos';
import { randomInt } from 'crypto';

const PLATFORM_FEE_RATE = 0.05; // 5% platform fee

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { card_id, payment_method, shipping_address } = body;

        if (!card_id || !payment_method) {
            return NextResponse.json({ error: 'card_id and payment_method are required' }, { status: 400 });
        }

        if (!['wallet', 'direct_payos'].includes(payment_method)) {
            return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
        }

        // Get card details
        const { data: card, error: cardError } = await supabase
            .from('cards')
            .select('*')
            .eq('id', card_id)
            .eq('status', 'active')
            .eq('listing_type', 'sale')
            .single();

        if (cardError || !card) {
            return NextResponse.json({ error: 'Card not found or not available' }, { status: 404 });
        }

        // Cannot buy your own card
        if (card.seller_id === user.id) {
            return NextResponse.json({ error: 'Cannot buy your own card' }, { status: 400 });
        }

        const amount = Number(card.price);
        const platformFee = Math.round(amount * PLATFORM_FEE_RATE);
        const totalPaid = amount; // Buyer pays the listed price; platform fee is deducted from seller payout

        if (payment_method === 'wallet') {
            // ── WALLET PAYMENT ──
            // Check wallet balance
            const { data: wallet, error: walletError } = await supabase
                .from('wallets')
                .select('*')
                .eq('user_id', user.id)
                .single();

            if (walletError || !wallet) {
                return NextResponse.json({ error: 'Wallet not found. Please deposit first.' }, { status: 400 });
            }

            if (wallet.available_balance < totalPaid) {
                return NextResponse.json({
                    error: 'Insufficient balance',
                    available: wallet.available_balance,
                    required: totalPaid,
                }, { status: 400 });
            }

            // Deduct from buyer wallet
            const newBalance = wallet.available_balance - totalPaid;
            const { error: deductError } = await supabase
                .from('wallets')
                .update({
                    available_balance: newBalance,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq('user_id', user.id);

            if (deductError) throw deductError;

            // Record wallet transaction
            await supabase.from('wallet_transactions').insert({
                wallet_id: wallet.id,
                user_id: user.id,
                type: 'marketplace_buy',
                amount: -totalPaid,
                balance_after: newBalance,
                description: `Mua thẻ: ${card.name}`,
                reference_id: card_id,
            } as never);

            // Create order (status = paid)
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    card_id,
                    seller_id: card.seller_id,
                    buyer_id: user.id,
                    amount,
                    platform_fee: platformFee,
                    total_paid: totalPaid,
                    payment_method: 'wallet',
                    status: 'paid',
                    shipping_address: shipping_address || null,
                } as never)
                .select()
                .single();

            if (orderError) throw orderError;

            // Mark card as sold
            await supabase
                .from('cards')
                .update({ status: 'sold', updated_at: new Date().toISOString() } as never)
                .eq('id', card_id);

            // Notify seller
            await supabase.from('notifications').insert({
                user_id: card.seller_id,
                type: 'order_new',
                title: 'Đơn hàng mới!',
                message: `Thẻ "${card.name}" đã được mua. Vui lòng giao hàng.`,
                card_id,
            } as never);

            return NextResponse.json({ success: true, order, payment_method: 'wallet' });

        } else {
            // ── DIRECT PAYOS PAYMENT ──
            const orderCode = randomInt(10_000_000, 99_999_999);

            // Create payment order
            const { data: paymentOrder, error: poError } = await supabase
                .from('payment_orders')
                .insert({
                    user_id: user.id,
                    order_code: orderCode,
                    package_type: 'deposit', // reuse deposit flow, will be handled by webhook
                    amount: totalPaid,
                    status: 'pending',
                } as never)
                .select()
                .single();

            if (poError) throw poError;

            // Create order (status = pending_payment)
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    card_id,
                    seller_id: card.seller_id,
                    buyer_id: user.id,
                    amount,
                    platform_fee: platformFee,
                    total_paid: totalPaid,
                    payment_method: 'direct_payos',
                    payment_order_id: paymentOrder.id,
                    status: 'pending_payment',
                    shipping_address: shipping_address || null,
                } as never)
                .select()
                .single();

            if (orderError) throw orderError;

            // Mark card as in_transaction
            await supabase
                .from('cards')
                .update({ status: 'in_transaction', updated_at: new Date().toISOString() } as never)
                .eq('id', card_id);

            // Create PayOS link
            const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

            const paymentLink = await getPayOS().paymentRequests.create({
                orderCode,
                amount: totalPaid,
                description: `Mua the ${card.name.substring(0, 20)}`,
                cancelUrl: `${origin}/orders?status=cancelled`,
                returnUrl: `${origin}/orders?status=success`,
                items: [{
                    name: card.name.substring(0, 50),
                    quantity: 1,
                    price: totalPaid,
                }],
            });

            // Update payment order with PayOS info
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
        }
    } catch (error: any) {
        console.error('Marketplace buy error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
