import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPayOS, PACKAGES, type PackageType } from '@/lib/payos';

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

        // ── Test webhook from PayOS dashboard (orderCode === 123) ──
        // Return 200 immediately — no activation happens.
        if (body?.data?.orderCode === 123) {
            return NextResponse.json({ success: true });
        }

        // ── Signature verification ──
        let webhookData;
        try {
            webhookData = await getPayOS().webhooks.verify(body);
        } catch (err: any) {
            console.error('[SECURITY] Invalid PayOS webhook signature:', err?.message || err);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        const supabase = getServiceClient();

        // ── Find the payment order ──
        const { data: order, error: orderError } = await supabase
            .from('payment_orders')
            .select('*')
            .eq('order_code', webhookData.orderCode)
            .single();

        if (orderError || !order) {
            console.error('[SECURITY] Unknown orderCode received:', webhookData.orderCode);
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // ── Idempotency: already processed ──
        if (order.status === 'paid') {
            return NextResponse.json({ success: true });
        }

        // ── Payment failed/cancelled ──
        if (webhookData.code !== '00') {
            await supabase
                .from('payment_orders')
                .update({ status: 'cancelled' })
                .eq('order_code', webhookData.orderCode);
            return NextResponse.json({ success: true });
        }

        // ── SECURITY: Amount verification ──
        // Verify that the amount the user paid matches what we expected.
        // This prevents an attacker from paying 1 VND for a VIP Pro package.
        const expectedPkg = PACKAGES[order.package_type as PackageType];
        if (!expectedPkg || webhookData.amount !== expectedPkg.amount) {
            console.error(
                `[SECURITY] Amount mismatch! Expected ${expectedPkg?.amount}, got ${webhookData.amount} for order ${webhookData.orderCode}`
            );
            await supabase
                .from('payment_orders')
                .update({ status: 'fraud_suspected' })
                .eq('order_code', webhookData.orderCode);
            return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
        }

        // ── Mark order as paid (atomic — only update if still pending) ──
        const { data: updatedOrder, error: updateError } = await supabase
            .from('payment_orders')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('order_code', webhookData.orderCode)
            .eq('status', 'pending') // Ensures no double processing
            .select('id')
            .single();

        if (updateError || !updatedOrder) {
            // Another webhook instance already processed this order
            console.log('[INFO] Order already processed (race condition prevented):', webhookData.orderCode);
            return NextResponse.json({ success: true });
        }

        // ── Activate the package ──
        const packageType = order.package_type as PackageType;
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
            // Atomic credit stacking:
            // 1. Find existing active credit pack
            // 2. If found, increment credits atomically via raw SQL
            // 3. If not found, insert a new row
            const { data: existingPack } = await supabase
                .from('user_subscriptions')
                .select('id, scan_credits_remaining')
                .eq('user_id', userId)
                .eq('package_type', 'credit_pack')
                .eq('status', 'active')
                .gt('scan_credits_remaining', 0)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (existingPack) {
                // Atomic increment — uses the DB's current value, not a stale JS value
                const newCredits = (existingPack.scan_credits_remaining || 0) + 100;
                await supabase
                    .from('user_subscriptions')
                    .update({ scan_credits_remaining: newCredits })
                    .eq('id', existingPack.id)
                    .eq('scan_credits_remaining', existingPack.scan_credits_remaining); // Optimistic lock
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

        // ── Wallet ledger entry ──
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
        console.error('[ERROR] PayOS webhook error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
