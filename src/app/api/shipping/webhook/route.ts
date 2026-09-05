import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// GHN Webhook — receives status updates for shipping orders
// GHN has NO self-service webhook screen and no registration endpoint — the
// URL is configured by GHN on their side. Email api@ghn.vn (or langnghe.ghn.vn/
// customer) with the four fields their docs ask for (api.ghn.vn/home/docs/detail?id=47):
//   Client ID       — the platform's GHN client id (not the shop id; the config
//                     is per client, so it covers every shop under it)
//   Url webhook     — https://cardversehub.com/api/shipping/webhook?token=<GHN_WEBHOOK_TOKEN>
//   Staging or Production
//   Name            — the shop / system name
// URL: https://cardversehub.com/api/shipping/webhook?token=<GHN_WEBHOOK_TOKEN>
//
// Security: this endpoint can flip an order to 'delivered', which starts the
// 72h auto-payout clock (complete_delivered_orders), so it must not be
// callable by strangers. GHN doesn't sign payloads — we authenticate with a
// shared-secret token in the URL (or x-webhook-token header). Fail closed:
// if GHN_WEBHOOK_TOKEN is unset we reject everything rather than accept
// forged "delivered" events.

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

        const { data, error } = await supabase.rpc('apply_shipping_webhook_event' as never, {
            p_ghn_order_code: String(OrderCode),
            p_status: String(Status),
        } as never);
        if (error) throw error;
        return NextResponse.json({ success: true, result: data });
    } catch (error: any) {
        console.error('[GHN Webhook] Error:', error);
        // Still return 200 to prevent GHN from retrying
        return NextResponse.json({ success: true, error: error.message });
    }
}
