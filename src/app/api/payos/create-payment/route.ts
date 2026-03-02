import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPayOS, PACKAGES, type PackageType } from '@/lib/payos';
import { randomInt } from 'crypto';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const packageType = body.packageType as PackageType;

        if (!packageType || !PACKAGES[packageType]) {
            return NextResponse.json({ error: 'Invalid package type' }, { status: 400 });
        }

        // ── Rate limiting: max 5 payment orders per minute per user ──
        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { count: recentOrders } = await supabase
            .from('payment_orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', oneMinuteAgo);

        if ((recentOrders ?? 0) >= 5) {
            return NextResponse.json(
                { error: 'Too many payment requests. Please wait a moment.' },
                { status: 429 }
            );
        }

        const pkg = PACKAGES[packageType];

        // ── Cryptographic orderCode: 8-digit random integer (10M–99M range) ──
        // This is far less predictable than Date.now() and avoids collisions.
        const orderCode = randomInt(10_000_000, 99_999_999);

        // Create payment order in database
        const { error: insertError } = await supabase
            .from('payment_orders')
            .insert({
                user_id: user.id,
                order_code: orderCode,
                package_type: packageType,
                amount: pkg.amount,
                status: 'pending',
            } as never);

        if (insertError) {
            console.error('Error creating payment order:', insertError);
            return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
        }

        // Create PayOS payment link using v2 SDK
        // IMPORTANT: Always use NEXT_PUBLIC_APP_URL for return/cancel URLs.
        // Using request.headers.get('origin') picks up Netlify deploy preview URLs
        // which breaks auth cookies and shows the wrong domain after payment.
        const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';

        const paymentLink = await getPayOS().paymentRequests.create({
            orderCode,
            amount: pkg.amount,
            description: pkg.description,
            cancelUrl: `${origin}/api/payos/return?status=cancelled&orderCode=${orderCode}`,
            returnUrl: `${origin}/api/payos/return?status=success&orderCode=${orderCode}`,
            items: [
                {
                    name: pkg.name,
                    quantity: 1,
                    price: pkg.amount,
                },
            ],
        });

        // Update order with PayOS info
        await supabase
            .from('payment_orders')
            .update({
                payos_payment_link_id: paymentLink.paymentLinkId,
                payos_checkout_url: paymentLink.checkoutUrl,
            } as never)
            .eq('order_code', orderCode);

        return NextResponse.json({
            checkoutUrl: paymentLink.checkoutUrl,
            qrCode: paymentLink.qrCode,
            orderCode,
        });
    } catch (error: any) {
        console.error('PayOS create payment error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error?.message || String(error)
        }, { status: 500 });
    }
}
