import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPayOS, MARKETPLACE_ORDER_PAYMENT_TYPE } from '@/lib/payos';
import { randomInt } from 'crypto';

const PLATFORM_FEE_RATE = 0.05; // 5% platform fee
const RESERVATION_MINUTES = 15; // How long a QR/PayOS checkout holds the card

type MarketplaceCard = {
    id: string;
    seller_id: string;
    name: string;
    price: number | null;
};

type WalletRow = {
    id: string;
    available_balance: number;
};

type PaymentOrderRow = {
    id: string;
};

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            card_id, payment_method, shipping_address,
            shipping_fee: clientShippingFee,
            to_name, to_phone,
            to_district_id, to_district_name,
            to_province_id, to_province_name,
            to_ward_code, to_ward_name,
            to_address_detail,
        } = body;

        const shippingFee = Math.max(0, parseInt(clientShippingFee) || 0);

        if (!card_id || !payment_method) {
            return NextResponse.json({ error: 'card_id and payment_method are required' }, { status: 400 });
        }

        if (!['wallet', 'direct_payos'].includes(payment_method)) {
            return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
        }

        if (
            !to_name ||
            !to_phone ||
            !to_district_id ||
            !to_district_name ||
            !to_province_id ||
            !to_province_name ||
            !to_ward_code ||
            !to_ward_name ||
            !to_address_detail
        ) {
            return NextResponse.json({ error: 'Shipping address is incomplete' }, { status: 400 });
        }

        // Free any cards whose PayOS reservation lapsed (buyer abandoned the QR
        // and PayOS never sent a cancel webhook) before we read this one, so a
        // previously-stuck card can be bought again.
        await supabase.rpc('release_expired_card_reservations' as never);

        // Get card details
        const { data: card, error: cardError } = await supabase
            .from('cards')
            .select('*')
            .eq('id', card_id)
            .eq('status', 'active')
            .eq('listing_type', 'sale')
            .single<MarketplaceCard>();

        if (cardError || !card) {
            const { data: existingCard } = await supabase
                .from('cards')
                .select('status, listing_type')
                .eq('id', card_id)
                .maybeSingle<{ status: string; listing_type: string | null }>();

            if (existingCard) {
                return NextResponse.json(
                    {
                        error: existingCard.status === 'in_transaction'
                            ? 'Thẻ này đang được người khác giữ để thanh toán. Vui lòng chọn thẻ khác hoặc quay lại sau vài phút.'
                            : 'Thẻ này đã được người khác mua hoặc không còn bán nữa. Vui lòng chọn thẻ khác.',
                        code: 'card_unavailable',
                        card_status: existingCard.status,
                    },
                    { status: 409 },
                );
            }

            return NextResponse.json({ error: 'Không tìm thấy thẻ này. Vui lòng tải lại trang và thử lại.', code: 'card_not_found' }, { status: 404 });
        }

        // Cannot buy your own card
        if (card.seller_id === user.id) {
            return NextResponse.json({ error: 'Cannot buy your own card' }, { status: 400 });
        }

        const amount = Number(card.price);
        const platformFee = Math.round(amount * PLATFORM_FEE_RATE);
        const totalPaid = amount + shippingFee; // Buyer pays listed price + shipping fee

        // Address persistence now lives in the shipping_addresses book (managed
        // straight from checkout), so the buy route no longer writes any
        // profiles.default_shipping_* defaults here.

        // Wallet pre-check (no mutation) — verify funds BEFORE claiming so we
        // never lock the card for a buyer who can't actually pay.
        let walletRow: WalletRow | null = null;
        if (payment_method === 'wallet') {
            const { data: wallet, error: walletError } = await supabase
                .from('wallets')
                .select('*')
                .eq('user_id', user.id)
                .single<WalletRow>();

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
            walletRow = wallet;
        }

        // Atomic claim — the concurrency gate. Only the first buyer flips the
        // card active → in_transaction; a simultaneous second buyer matches 0
        // rows here and is rejected, so one card can never be sold twice.
        const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);
        const { data: claimed } = await supabase
            .from('cards')
            .update({
                status: 'in_transaction',
                reserved_until: reservedUntil.toISOString(),
                updated_at: new Date().toISOString(),
            } as never)
            .eq('id', card_id)
            .eq('status', 'active')
            .eq('listing_type', 'sale')
            .select('id')
            .maybeSingle();

        if (!claimed) {
            return NextResponse.json(
                { error: 'Thẻ này vừa được người khác mua. Vui lòng chọn thẻ khác.', code: 'card_unavailable' },
                { status: 409 },
            );
        }

        try {
        if (payment_method === 'wallet') {
            // ── WALLET PAYMENT ──
            const wallet = walletRow!;
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
                    shipping_fee: shippingFee,
                    payment_method: 'wallet',
                    status: 'paid',
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
                } as never)
                .select()
                .single();

            if (orderError) throw orderError;

            // Mark card as sold and clear the reservation hold
            await supabase
                .from('cards')
                .update({ status: 'sold', reserved_until: null, updated_at: new Date().toISOString() } as never)
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
                    package_type: MARKETPLACE_ORDER_PAYMENT_TYPE,
                    amount: totalPaid,
                    status: 'pending',
                } as never)
                .select()
                .single<PaymentOrderRow>();

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
                    shipping_fee: shippingFee,
                    payment_method: 'direct_payos',
                    payment_order_id: paymentOrder.id,
                    status: 'pending_payment',
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
                } as never)
                .select()
                .single();

            if (orderError) throw orderError;

            // Card is already reserved by the atomic claim above (for
            // RESERVATION_MINUTES). Create the PayOS link.
            const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

            const paymentLink = await getPayOS().paymentRequests.create({
                orderCode,
                amount: totalPaid,
                description: `Mua the ${card.name.substring(0, 20)}`,
                // Expire the link with the reservation so PayOS also fires a
                // cancel webhook (which releases the card) when time runs out.
                expiredAt: Math.floor(reservedUntil.getTime() / 1000),
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
        } catch (err) {
            // Roll back the claim so a failed transaction doesn't strand the card.
            await supabase
                .from('cards')
                .update({ status: 'active', reserved_until: null, updated_at: new Date().toISOString() } as never)
                .eq('id', card_id)
                .eq('status', 'in_transaction');
            throw err;
        }
    } catch (error: any) {
        console.error('Marketplace buy error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
