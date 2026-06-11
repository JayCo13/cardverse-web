import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// GHN Webhook — receives status updates for shipping orders
// Configure webhook URL at: https://khachhang.ghn.vn → Settings → Webhook
// URL: https://cardversehub.com/api/shipping/webhook?token=<GHN_WEBHOOK_TOKEN>
//
// Security: this endpoint can flip an order to 'delivered', which starts the
// 72h auto-payout clock (complete_delivered_orders), so it must not be
// callable by strangers. GHN doesn't sign payloads — we authenticate with a
// shared-secret token in the URL (or x-webhook-token header). Fail closed:
// if GHN_WEBHOOK_TOKEN is unset we reject everything rather than accept
// forged "delivered" events.

// Order statuses that no webhook event may override.
const TERMINAL_STATUSES = ['completed', 'cancelled', 'refunded', 'disputed'];

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: NextRequest) {
    const expectedToken = process.env.GHN_WEBHOOK_TOKEN;
    if (!expectedToken) {
        console.error('[GHN Webhook] GHN_WEBHOOK_TOKEN is not set — rejecting webhook');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 });
    }

    const providedToken = request.nextUrl.searchParams.get('token')
        || request.headers.get('x-webhook-token')
        || '';
    // Constant-time compare via fixed-length digests (handles length mismatch).
    if (!timingSafeEqual(sha256(providedToken), sha256(expectedToken))) {
        console.warn('[GHN Webhook] Invalid webhook token');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        // GHN webhook payload
        const {
            OrderCode,       // GHN order code
            Status,          // New status
            ClientOrderCode, // Our internal order ID
        } = body;

        if (!OrderCode || !Status) {
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        console.log(`[GHN Webhook] Order: ${OrderCode}, Status: ${Status}, Client: ${ClientOrderCode}`);

        // Service-role client: this runs with no user session, and orders /
        // notifications writes must not depend on RLS being open to anon.
        const supabase = createServiceSupabaseClient();

        // Find order by GHN order code
        const { data: orderData, error: findError } = await supabase
            .from('orders')
            .select('id, buyer_id, seller_id, status, ghn_status, card_id')
            .eq('ghn_order_code', OrderCode)
            .single();

        const order = orderData as {
            id: string; buyer_id: string; seller_id: string;
            status: string; ghn_status: string | null; card_id: string;
        } | null;

        if (findError || !order) {
            console.warn(`[GHN Webhook] Order not found for GHN code: ${OrderCode}`);
            // Return 200 to prevent GHN from retrying
            return NextResponse.json({ success: true, message: 'Order not found but acknowledged' });
        }

        // Terminal orders are immutable; duplicate events are GHN retries.
        if (TERMINAL_STATUSES.includes(order.status)) {
            return NextResponse.json({ success: true, message: 'Order in terminal status, ignored' });
        }
        if (order.ghn_status === Status) {
            return NextResponse.json({ success: true, message: 'Status unchanged, ignored' });
        }

        // Update GHN status
        const updateData: Record<string, unknown> = {
            ghn_status: Status,
            updated_at: new Date().toISOString(),
        };

        // Map GHN status to our order status
        if (Status === 'delivered') {
            if (order.status === 'shipping') {
                updateData.status = 'delivered';
                // The 72h buyer-confirmation window starts at DELIVERY, not at
                // ship time. complete_delivered_orders() pays the seller once
                // this lapses without a dispute.
                updateData.auto_complete_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
            }
        } else if (['cancel', 'returned', 'return'].includes(Status)) {
            // Don't auto-change status for returns/cancels — admin should handle
            console.log(`[GHN Webhook] GHN status ${Status} — requires admin review`);
        }

        await supabase
            .from('orders')
            .update(updateData as never)
            .eq('id', order.id);

        // Send notifications based on status
        const statusMessages: Record<string, { buyer?: string; seller?: string }> = {
            picking: {
                buyer: 'Shipper đang đến lấy hàng từ người bán.',
            },
            picked: {
                buyer: 'Đơn hàng đã được lấy và đang trên đường đến bạn.',
                seller: 'Shipper đã lấy hàng thành công.',
            },
            delivering: {
                buyer: 'Shipper đang giao hàng đến bạn. Vui lòng chuẩn bị nhận hàng!',
            },
            delivered: {
                buyer: 'Đơn hàng đã được giao thành công! Hãy xác nhận nhận hàng để hoàn tất.',
                seller: 'Đơn hàng đã được giao thành công đến người mua.',
            },
            delivery_fail: {
                buyer: 'Giao hàng không thành công. Shipper sẽ thử lại.',
                seller: 'Giao hàng thất bại. GHN sẽ thử giao lại.',
            },
        };

        const messages = statusMessages[Status];
        if (messages) {
            const notifications: Array<Record<string, unknown>> = [];

            if (messages.buyer) {
                notifications.push({
                    user_id: order.buyer_id,
                    type: 'shipping_update',
                    title: '📦 Cập nhật vận chuyển',
                    message: messages.buyer,
                    card_id: order.card_id,
                });
            }

            if (messages.seller) {
                notifications.push({
                    user_id: order.seller_id,
                    type: 'shipping_update',
                    title: '📦 Cập nhật vận chuyển',
                    message: messages.seller,
                    card_id: order.card_id,
                });
            }

            if (notifications.length > 0) {
                await supabase.from('notifications').insert(notifications as never[]);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[GHN Webhook] Error:', error);
        // Still return 200 to prevent GHN from retrying
        return NextResponse.json({ success: true, error: error.message });
    }
}
