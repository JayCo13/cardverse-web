import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS } from '@/lib/payos';
import { matchBundleSelection, type BundleSelection } from '@/lib/bundle';
import { randomInt } from 'crypto';
import { hashFinancialRequest, stableFinancialUuid } from '@/lib/financial-idempotency';
import { quoteVerifiedShipping } from '@/lib/verified-shipping';
import { attachClaimedPayOSLink, claimPayOSLinkCreation } from '@/lib/payos-link-claim';
import { translateRequest } from '@/lib/request-localization';

// Fee model: the 5% platform fee is charged once, at withdrawal — orders carry
// platform_fee = 0 and the seller is credited the full amount on completion.
const RESERVATION_MINUTES = 15; // How long a QR/PayOS checkout holds the card

type MarketplaceCard = {
    id: string;
    seller_id: string;
    name: string;
    price: number | null;
    is_bundle: boolean | null;
    bundle_items: Array<{ title?: string; price?: number }> | null;
};


type PaymentOrderRow = {
    id: string;
    order_code: number;
};

type WalletOrderResult = {
    orders: Array<Record<string, unknown>>;
    replayed: boolean;
};

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const idempotencyKey = request.headers.get('idempotency-key');
        const {
            card_id, payment_method, shipping_address,
            shipping_carrier: clientCarrier,
            to_name, to_phone,
            to_district_id, to_district_name,
            to_province_id, to_province_name,
            to_ward_code, to_ward_name,
            to_address_detail,
        } = body;

        if (!card_id || !payment_method) {
            return NextResponse.json({ error: 'card_id and payment_method are required' }, { status: 400 });
        }

        if (!['wallet', 'direct_payos'].includes(payment_method)) {
            return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
        }
        if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
            return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
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

        const selection: BundleSelection[] = Array.isArray(body.bundle_selection)
            ? body.bundle_selection.map((item: unknown) => {
                const value = item as { title?: unknown; price?: unknown };
                return { title: String(value?.title ?? ''), price: Number(value?.price) || 0 };
            })
            : [];
        const apiRequestHash = hashFinancialRequest({
            version: 1,
            route: 'marketplace_buy',
            user_id: user.id,
            card_id,
            payment_method,
            shipping_address: shipping_address || null,
            shipping_carrier: clientCarrier || null,
            to_name,
            to_phone,
            to_district_id,
            to_district_name,
            to_province_id,
            to_province_name,
            to_ward_code,
            to_ward_name,
            to_address_detail,
            bundle_selection: selection,
        });
        const service = createServiceSupabaseClient();
        const { data: replayData, error: replayError } = await service.rpc(
            'get_marketplace_checkout_replay' as never,
            {
                p_user_id: user.id,
                p_idempotency_key: idempotencyKey,
                p_request_hash: apiRequestHash,
            } as never,
        );
        if (replayError) {
            const conflict = replayError.message.includes('idempotency_conflict');
            return NextResponse.json(
                { error: conflict ? 'Idempotency key conflicts with another checkout.' : 'Could not replay checkout.', code: conflict ? 'idempotency_conflict' : 'checkout_replay_failed' },
                { status: conflict ? 409 : 500 },
            );
        }
        const replay = replayData as unknown as {
            found?: boolean;
            payment_method?: 'wallet' | 'direct_payos';
            orders?: Array<Record<string, unknown>>;
            payment_order?: { checkout_url?: string | null; order_code?: number };
        };
        if (replay.found) {
            const order = replay.orders?.[0];
            if (replay.payment_method === 'wallet' && order) {
                return NextResponse.json({ success: true, order, payment_method: 'wallet', replayed: true });
            }
            if (replay.payment_method === 'direct_payos' && order && replay.payment_order?.checkout_url) {
                return NextResponse.json({
                    success: true,
                    order,
                    payment_method: 'direct_payos',
                    checkoutUrl: replay.payment_order.checkout_url,
                    orderCode: replay.payment_order.order_code,
                    replayed: true,
                });
            }
            return NextResponse.json({
                error: 'Checkout exists, but the PayOS link is not ready. Do not create another payment; contact support.',
                code: 'payment_link_recovery_required',
            }, { status: 409 });
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
                            ? 'This card is reserved by another buyer. Choose another card or try again later.'
                            : 'This card was purchased or is no longer listed. Please choose another card.',
                        code: 'card_unavailable',
                        card_status: existingCard.status,
                    },
                    { status: 409 },
                );
            }

            return NextResponse.json({ error: 'Card not found. Refresh the page and try again.', code: 'card_not_found' }, { status: 404 });
        }

        // Cannot buy your own card
        if (card.seller_id === user.id) {
            return NextResponse.json({ error: 'Cannot buy your own card' }, { status: 400 });
        }

        // ── Bundle: buyer picks specific cards; the rest stays listed ──
        const isBundle = !!card.is_bundle;
        let amount: number;
        let bundleRemaining: Array<{ title?: string; price?: number }> | null = null;

        if (isBundle) {
            if (selection.length === 0) {
                return NextResponse.json({ error: 'Select at least one card from the bundle.', code: 'no_bundle_selection' }, { status: 400 });
            }
            const items = Array.isArray(card.bundle_items) ? card.bundle_items : [];
            const matched = matchBundleSelection(items, selection);
            if (!matched) {
                return NextResponse.json({ error: 'Some selected bundle cards are no longer available. Refresh the page.', code: 'bundle_item_unavailable' }, { status: 409 });
            }
            amount = matched.matchedTotal;
            bundleRemaining = matched.remaining;
            // Partial purchase is finalized on payment: wallet immediately (below),
            // PayOS in the webhook — both remove the bought cards from the bundle.
        } else {
            amount = Number(card.price);
        }

        // Never trust the fee echoed by the browser. Re-quote from the seller's
        // stored origin and the authenticated checkout destination.
        const shippingFee = await quoteVerifiedShipping({
            sellerId: card.seller_id,
            toDistrictId: Number(to_district_id),
            toWardCode: String(to_ward_code),
            insuranceValue: amount,
            itemCount: isBundle ? selection.length : 1,
        });

        const totalPaid = amount + shippingFee; // Buyer pays selected price + shipping fee

        // Address persistence now lives in the shipping_addresses book (managed
        // straight from checkout), so the buy route no longer writes any
        // profiles.default_shipping_* defaults here.

        const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);
        const orderId = stableFinancialUuid(`marketplace-buy:${user.id}:${idempotencyKey}`);
        const orderSpec = {
            order_id: orderId,
            card_id,
            seller_id: card.seller_id,
            amount,
            shipping_fee: shippingFee,
            total_paid: totalPaid,
            metadata: {
                api_request_hash: apiRequestHash,
                ...(isBundle ? { bundle_selection: selection } : {}),
                ...(clientCarrier ? { shipping_carrier: String(clientCarrier) } : {}),
            },
            ...(isBundle ? { bundle_items_before: card.bundle_items || [] } : {}),
            shipping_address: shipping_address || null,
            to_name,
            to_phone,
            to_district_id,
            to_district_name,
            to_province_id,
            to_province_name,
            to_ward_code,
            to_ward_name,
            to_address_detail,
        };

        try {
        if (payment_method === 'wallet') {
            // Order creation, inventory finalization, verified FIFO allocation,
            // wallet debit, funding evidence and transaction finalization all
            // commit (or roll back) together inside this RPC.
            const walletOrderSpec = {
                ...orderSpec,
                ...(isBundle ? { bundle_remaining: bundleRemaining || [] } : {}),
            };
            const { data: walletResultData, error: walletOrderError } = await service.rpc(
                'create_verified_wallet_marketplace_orders' as never,
                {
                p_user_id: user.id,
                p_orders: [walletOrderSpec],
                p_idempotency_key: idempotencyKey,
                p_description: `Card purchase: ${card.name}`,
                } as never,
            );

            if (walletOrderError || !walletResultData) {
                const conflict = new Error('Verified balance is insufficient or changed. Please try again.');
                (conflict as any).status = 409;
                (conflict as any).code = 'verified_balance_changed';
                throw conflict;
            }
            const walletResult = walletResultData as unknown as WalletOrderResult;
            const order = walletResult.orders?.[0];
            if (!order) throw new Error('Atomic wallet order did not return an order');

            const soldLabel = isBundle ? `${selection.length} cards from bundle "${card.name}"` : `Card "${card.name}"`;
            const { error: notificationError } = await service.from('notifications').insert({
                user_id: card.seller_id,
                type: 'order_new',
                title: 'New order!',
                message: `${soldLabel} was purchased. Please ship the order.`,
                card_id,
                order_id: (order as any).id,
            } as never);
            if (notificationError) {
                console.error('Wallet order notification failed:', notificationError);
            }

            return NextResponse.json({ success: true, order, payment_method: 'wallet' });

        } else {
            // ── DIRECT PAYOS PAYMENT ──
            const orderCode = randomInt(10_000_000, 99_999_999);
            const { data: stagedData, error: stageError } = await service.rpc(
                'stage_payos_marketplace_checkout' as never,
                {
                    p_user_id: user.id,
                    p_order_code: orderCode,
                    p_orders: [orderSpec],
                    p_idempotency_key: idempotencyKey,
                    p_reserved_until: reservedUntil.toISOString(),
                } as never,
            );
            const staged = stagedData as unknown as {
                payment_order?: PaymentOrderRow & { payos_checkout_url?: string | null };
                orders?: Array<Record<string, unknown>>;
            };
            const paymentOrder = staged?.payment_order;
            const order = staged?.orders?.[0];
            if (stageError || !paymentOrder || !order) {
                throw stageError || new Error('Could not stage PayOS marketplace checkout');
            }
            const persistedOrderCode = Number(paymentOrder.order_code);
            if (paymentOrder.payos_checkout_url) {
                return NextResponse.json({
                    success: true,
                    order,
                    payment_method: 'direct_payos',
                    checkoutUrl: paymentOrder.payos_checkout_url,
                    orderCode: persistedOrderCode,
                });
            }
            const linkClaim = await claimPayOSLinkCreation(service, user.id, persistedOrderCode);
            if (linkClaim.checkoutUrl) {
                return NextResponse.json({
                    success: true,
                    order,
                    payment_method: 'direct_payos',
                    checkoutUrl: linkClaim.checkoutUrl,
                    orderCode: persistedOrderCode,
                    replayed: true,
                });
            }

            // Card is already reserved by the atomic claim above (for
            // RESERVATION_MINUTES). Create the PayOS link.
            const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

            const paymentLink = await getPayOS().paymentRequests.create({
                orderCode: persistedOrderCode,
                amount: totalPaid,
                // PayOS caps the description at 25 characters.
                description: translateRequest(request, 'payos_description_card_purchase').slice(0, 25),
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

            // PayOS occasionally returns no checkout URL — treat it as a failure
            // and keep the staged reservation fail-closed for expiry/operator
            // recovery. Releasing it here could expose a provider-created but
            // locally unrecorded payment link to a second buyer.
            if (!paymentLink?.checkoutUrl) {
                throw new Error('PayOS did not return a payment link. Please try again.');
            }

            // Update payment order with PayOS info
            await attachClaimedPayOSLink(service, {
                userId: user.id,
                orderCode: persistedOrderCode,
                claimId: linkClaim.claimId!,
                paymentLinkId: paymentLink.paymentLinkId,
                checkoutUrl: paymentLink.checkoutUrl,
            });

            return NextResponse.json({
                success: true,
                order,
                payment_method: 'direct_payos',
                checkoutUrl: paymentLink.checkoutUrl,
                qrCode: paymentLink.qrCode,
                orderCode: persistedOrderCode,
            });
        }
        } catch (err) {
            throw err;
        }
    } catch (error: any) {
        console.error('Marketplace buy error:', error);
        // Only trust a proper 4xx/5xx error status; some SDK errors (e.g. PayOS)
        // carry status 200, which must NOT be sent back as a "successful" response.
        const status = typeof error?.status === 'number' && error.status >= 400 ? error.status : 500;
        return NextResponse.json(
            { error: error.message || 'Internal server error', ...(error?.code ? { code: error.code } : {}) },
            { status },
        );
    }
}
