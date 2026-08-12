import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS } from '@/lib/payos';
import { randomInt } from 'crypto';
import { attachClaimedPayOSLink, claimPayOSLinkCreation } from '@/lib/payos-link-claim';
import { translateRequest } from '@/lib/request-localization';

// POST: Create wallet deposit via PayOS
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const amount = Number(body.amount);
        const idempotencyKey = request.headers.get('idempotency-key');

        // Validate amount (min 10k, max 50M VND)
        if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 50000000) {
            return NextResponse.json(
                { error: 'Invalid deposit amount.', code: 'invalid_deposit_amount' },
                { status: 400 },
            );
        }
        if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
            return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
        }

        const orderCode = randomInt(10_000_000, 99_999_999);

        // Create payment order
        const service = createServiceSupabaseClient();
        const { data: paymentOrder, error: insertError } = await service.rpc('create_server_payment_order' as never, {
            p_user_id: user.id,
            p_order_code: orderCode,
            p_package_type: 'deposit',
            p_amount: amount,
            p_currency: 'VND',
            p_idempotency_key: idempotencyKey,
        } as never);

        if (insertError) {
            const rateLimited = insertError.message.includes('payment_rate_limited');
            const conflict = insertError.message.includes('idempotency_conflict');
            return NextResponse.json(
                {
                    error: rateLimited
                        ? 'Too many requests. Please wait.'
                        : conflict
                            ? 'Idempotency key conflict.'
                            : 'Failed to create deposit order',
                    code: rateLimited
                        ? 'payment_rate_limited'
                        : conflict
                            ? 'idempotency_conflict'
                            : 'deposit_failed',
                },
                { status: rateLimited ? 429 : conflict ? 409 : 500 },
            );
        }
        const persisted = paymentOrder as {
            order_code?: number;
            payos_checkout_url?: string | null;
        } | null;
        const persistedOrderCode = Number(persisted?.order_code || orderCode);
        if (persisted?.payos_checkout_url) {
            return NextResponse.json({
                checkoutUrl: persisted.payos_checkout_url,
                qrCode: null,
                orderCode: persistedOrderCode,
                replayed: true,
            });
        }
        const linkClaim = await claimPayOSLinkCreation(service, user.id, persistedOrderCode);
        if (linkClaim.checkoutUrl) {
            return NextResponse.json({
                checkoutUrl: linkClaim.checkoutUrl,
                qrCode: null,
                orderCode: persistedOrderCode,
                replayed: true,
            });
        }

        // Create PayOS payment link
        const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const paymentLink = await getPayOS().paymentRequests.create({
            orderCode: persistedOrderCode,
            amount: amount,
            description: translateRequest(request, 'payos_description_wallet_deposit').slice(0, 25),
            cancelUrl: `${origin}/wallet?status=cancelled`,
            returnUrl: `${origin}/wallet?status=success`,
            items: [
                {
                    name: 'Cardverse Wallet Deposit',
                    quantity: 1,
                    price: amount,
                },
            ],
        });

        // Update order with PayOS info
        await attachClaimedPayOSLink(service, {
            userId: user.id,
            orderCode: persistedOrderCode,
            claimId: linkClaim.claimId!,
            paymentLinkId: paymentLink.paymentLinkId,
            checkoutUrl: paymentLink.checkoutUrl,
        });

        return NextResponse.json({
            checkoutUrl: paymentLink.checkoutUrl,
            qrCode: paymentLink.qrCode,
            orderCode: persistedOrderCode,
        });
    } catch (error: any) {
        console.error('Wallet deposit error:', error);
        const status = typeof error?.status === 'number' ? error.status : 500;
        return NextResponse.json(
            { error: error.message || 'Internal server error', code: 'deposit_failed' },
            { status }
        );
    }
}
