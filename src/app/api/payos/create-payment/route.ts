import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS, PACKAGES, type PackageType } from '@/lib/payos';
import { randomInt } from 'crypto';
import { attachClaimedPayOSLink, claimPayOSLinkCreation } from '@/lib/payos-link-claim';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const packageType = body.packageType as PackageType;
        const idempotencyKey = request.headers.get('idempotency-key');

        if (!packageType || !PACKAGES[packageType]) {
            return NextResponse.json({ error: 'Invalid package type' }, { status: 400 });
        }
        if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
            return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
        }

        const pkg = PACKAGES[packageType];

        // ── Cryptographic orderCode: 8-digit random integer (10M–99M range) ──
        // This is far less predictable than Date.now() and avoids collisions.
        const orderCode = randomInt(10_000_000, 99_999_999);

        // Create payment order in database
        const service = createServiceSupabaseClient();
        const { data: paymentOrder, error: insertError } = await service.rpc('create_server_payment_order' as never, {
            p_user_id: user.id,
            p_order_code: orderCode,
            p_package_type: packageType,
            p_amount: pkg.amount,
            p_currency: 'VND',
            p_idempotency_key: idempotencyKey,
        } as never);

        if (insertError) {
            console.error('Error creating payment order:', insertError);
            const rateLimited = insertError.message.includes('payment_rate_limited');
            const conflict = insertError.message.includes('idempotency_conflict');
            return NextResponse.json(
                { error: rateLimited ? 'Too many payment requests. Please wait a moment.' : conflict ? 'Idempotency key conflict.' : 'Failed to create order' },
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

        // Create PayOS payment link using v2 SDK
        // IMPORTANT: Always use NEXT_PUBLIC_APP_URL for return/cancel URLs.
        // Using request.headers.get('origin') picks up Netlify deploy preview URLs
        // which breaks auth cookies and shows the wrong domain after payment.
        const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';

        const paymentLink = await getPayOS().paymentRequests.create({
            orderCode: persistedOrderCode,
            amount: pkg.amount,
            description: pkg.description,
            cancelUrl: `${origin}/api/payos/return`,
            returnUrl: `${origin}/api/payos/return`,
            items: [
                {
                    name: pkg.name,
                    quantity: 1,
                    price: pkg.amount,
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
        console.error('PayOS create payment error:', error);
        const status = typeof error?.status === 'number' ? error.status : 500;
        return NextResponse.json({
            error: 'Internal server error',
            details: error?.message || String(error)
        }, { status });
    }
}
