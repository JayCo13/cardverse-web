import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPayOS } from '@/lib/payos';

// Use service role client for webhook (no user session)
function getServiceClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        let webhookData;

        // Skip test webhook from PayOS (orderCode === 123) - bypasses signature check
        // This ensures the PayOS dashboard successfully registers the URL, even if
        // the checksum key on Netlify has a temporary mismatch or is missing.
        if (body?.data?.orderCode === 123) {
            return NextResponse.json({ success: true });
        }

        try {
            webhookData = await getPayOS().webhooks.verify(body);
        } catch (err: any) {
            console.error('Invalid PayOS webhook signature:', err?.message || err, body);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        const supabase = getServiceClient();

        // Find the payment order
        const { data: order, error: orderError } = await supabase
            .from('payment_orders')
            .select('*')
            .eq('order_code', webhookData.orderCode)
            .single();

        if (orderError || !order) {
            console.error('Payment order not found:', webhookData.orderCode);
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // Already processed
        if (order.status === 'paid') {
            return NextResponse.json({ success: true });
        }

        // Check if payment was successful
        if (webhookData.code !== '00') {
            await supabase
                .from('payment_orders')
                .update({ status: 'cancelled' })
                .eq('order_code', webhookData.orderCode);
            return NextResponse.json({ success: true });
        }

        // Mark order as paid
        await supabase
            .from('payment_orders')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('order_code', webhookData.orderCode);

        // Activate the package
        const packageType = order.package_type;
        const userId = order.user_id;

        if (packageType === 'day_pass') {
            await supabase.from('user_subscriptions').insert({
                user_id: userId,
                package_type: 'day_pass',
                status: 'active',
                starts_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                payment_reference: String(webhookData.orderCode),
            });
        } else if (packageType === 'credit_pack') {
            // Add 100 scan credits — stack on existing pack if exists
            const { data: existingPack } = await supabase
                .from('user_subscriptions')
                .select('id, scan_credits_remaining')
                .eq('user_id', userId)
                .eq('package_type', 'credit_pack')
                .eq('status', 'active')
                .gt('scan_credits_remaining', 0)
                .single();

            if (existingPack) {
                await supabase
                    .from('user_subscriptions')
                    .update({
                        scan_credits_remaining: (existingPack.scan_credits_remaining || 0) + 100,
                    })
                    .eq('id', existingPack.id);
            } else {
                await supabase.from('user_subscriptions').insert({
                    user_id: userId,
                    package_type: 'credit_pack',
                    status: 'active',
                    scan_credits_remaining: 100,
                    payment_reference: String(webhookData.orderCode),
                });
            }
        } else if (packageType === 'vip_pro') {
            // Check if user has existing VIP Pro — extend it
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

        // Create wallet transaction (ledger entry)
        const { data: wallet } = await supabase
            .from('wallets')
            .select('id, available_balance')
            .eq('user_id', userId)
            .single();

        if (wallet) {
            await supabase.from('wallet_transactions').insert({
                wallet_id: wallet.id,
                user_id: userId,
                type: packageType === 'vip_pro' ? 'vip_subscription' : 'scan_purchase',
                amount: -order.amount,
                balance_after: wallet.available_balance,
                description: `Purchased ${packageType.replace('_', ' ')}`,
                reference_id: String(webhookData.orderCode),
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('PayOS webhook error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
