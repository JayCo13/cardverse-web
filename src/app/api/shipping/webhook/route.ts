import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// GHN Webhook — receives status updates for shipping orders
// Configure webhook URL at: https://khachhang.ghn.vn → Settings → Webhook
// URL: https://cardversehub.com/api/shipping/webhook

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // GHN webhook payload
        const {
            OrderCode,       // GHN order code
            Status,          // New status
            ClientOrderCode, // Our internal order ID
            Description,
            Type,
        } = body;

        if (!OrderCode || !Status) {
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        console.log(`[GHN Webhook] Order: ${OrderCode}, Status: ${Status}, Client: ${ClientOrderCode}`);

        const supabase = await createServerSupabaseClient();

        // Find order by GHN order code
        const { data: orderData, error: findError } = await supabase
            .from('orders')
            .select('id, buyer_id, seller_id, status, card_id')
            .eq('ghn_order_code', OrderCode)
            .single();

        const order = orderData as { id: string; buyer_id: string; seller_id: string; status: string; card_id: string } | null;

        if (findError || !order) {
            console.warn(`[GHN Webhook] Order not found for GHN code: ${OrderCode}`);
            // Return 200 to prevent GHN from retrying
            return NextResponse.json({ success: true, message: 'Order not found but acknowledged' });
        }

        // Update GHN status
        const updateData: Record<string, unknown> = {
            ghn_status: Status,
            updated_at: new Date().toISOString(),
        };

        // Map GHN status to our order status
        if (Status === 'delivered') {
            updateData.status = 'delivered';
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
