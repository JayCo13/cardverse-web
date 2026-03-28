import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPayOS } from '@/lib/payos';
import { randomInt } from 'crypto';

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

        // Validate amount (min 10k, max 50M VND)
        if (!amount || amount < 10000 || amount > 50000000) {
            return NextResponse.json({ error: 'Invalid amount. Min: 10,000 VND, Max: 50,000,000 VND' }, { status: 400 });
        }

        // Rate limiting: max 5 deposit orders per minute
        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { count: recentOrders } = await supabase
            .from('payment_orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('package_type', 'deposit')
            .gte('created_at', oneMinuteAgo);

        if ((recentOrders ?? 0) >= 5) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait.' },
                { status: 429 }
            );
        }

        const orderCode = randomInt(10_000_000, 99_999_999);

        // Create payment order
        const { error: insertError } = await supabase
            .from('payment_orders')
            .insert({
                user_id: user.id,
                order_code: orderCode,
                package_type: 'deposit',
                amount: amount,
                status: 'pending',
            } as never);

        if (insertError) throw insertError;

        // Create PayOS payment link
        const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const paymentLink = await getPayOS().paymentRequests.create({
            orderCode,
            amount: amount,
            description: `Nap vi CV ${amount.toLocaleString()}d`,
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
        console.error('Wallet deposit error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
