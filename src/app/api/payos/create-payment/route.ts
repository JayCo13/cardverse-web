import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPayOS, PACKAGES, type PackageType } from '@/lib/payos';

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

        const pkg = PACKAGES[packageType];
        const orderCode = Date.now();

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
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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
        // Include the actual error message dynamically to find out what's failing in production
        return NextResponse.json({
            error: 'Internal server error',
            details: error?.message || String(error)
        }, { status: 500 });
    }
}
