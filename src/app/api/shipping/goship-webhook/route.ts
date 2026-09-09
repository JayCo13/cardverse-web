import { NextRequest, NextResponse } from 'next/server';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { readGoshipEvent } from '@/lib/goship-webhook';
import { goshipClientSecret, type GoshipEnv } from '@/lib/goship';
import { notifyCarrierStatusChange } from '@/lib/carrier-notifications';

/**
 * Status pushes from GoShip.
 *
 * Two independent checks, because they fail in different ways. The URL secret
 * proves the caller knows something only GoShip was told; the HMAC proves the
 * body was not altered on the way. The signature is the stronger of the two and
 * is used whenever GOSHIP_CLIENT_SECRET is set, which it now is in production.
 * The URL secret is kept anyway: it is checked before the body is read, and it
 * still stands alone anywhere the client secret is missing. An absent secret
 * must never mean an open door.
 *
 * GoShip retries a non-200 after three minutes, three times, then gives up. So
 * a failure we could recover from answers 500 and gets another go, while an
 * event we understood and chose not to act on answers 200 — asking for a retry
 * of something already decided would only repeat it.
 */

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Which account sent this, decided by the secret on the URL.
 *
 * Both accounts push to this one public address, so the token is what tells
 * them apart — a different one is issued to each, and the environment is
 * whichever it matches. Nothing is read from the body to make this decision:
 * the body is the part an attacker controls.
 *
 * Null means neither matched, which is the same answer as an unconfigured
 * environment. A missing secret must never widen the door.
 */
const senderEnv = (provided: string): GoshipEnv | null => {
    for (const [env, expected] of [
        ['live', process.env.GOSHIP_WEBHOOK_TOKEN],
        ['sandbox', process.env.GOSHIP_WEBHOOK_TOKEN_SANDBOX],
    ] as const) {
        if (expected && timingSafeEqual(sha256(provided), sha256(expected))) return env;
    }
    return null;
};

export async function POST(request: NextRequest) {
    const providedToken = request.nextUrl.searchParams.get('token')
        || request.headers.get('x-webhook-token')
        || '';

    const env = senderEnv(providedToken);
    if (!env) {
        console.warn('[GoShip Webhook] Invalid token');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read once, as text: the signature covers the exact bytes sent, and
    // re-serialising parsed JSON would not reproduce them.
    const raw = await request.text();

    // The signing secret belongs to the account, so it has to be the one
    // matching the token above. Checking a sandbox event against the live
    // secret would reject every one of them.
    const secret = goshipClientSecret(env);
    if (secret) {
        const signature = request.headers.get('x-goship-hmac-sha256') || '';
        const expected = createHmac('sha256', secret).update(raw).digest('base64');
        if (!timingSafeEqual(sha256(signature), sha256(expected))) {
            console.warn(`[GoShip Webhook] Bad signature (${env})`);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        // Unreadable now is unreadable in three minutes. Acknowledge it.
        console.error('[GoShip Webhook] Body is not JSON');
        return NextResponse.json({ success: true, ignored: 'unparseable' });
    }

    const event = readGoshipEvent(body);
    if (!event) {
        // A status this codebase has not been taught, or a payload with no
        // gcode. Logged rather than guessed at: the alternative is a made-up
        // status written onto an order.
        console.warn('[GoShip Webhook] Unusable event:', JSON.stringify(body).slice(0, 300));
        return NextResponse.json({ success: true, ignored: 'unusable_event' });
    }

    try {
        const service = createServiceSupabaseClient();

        const { data, error } = await service.rpc('apply_goship_event' as never, {
            p_goship_code: event.gcode,
            p_status: event.carrierStatus,
            p_sub_status: event.statusText,
            p_carrier_code: event.carrierCode,
            // The carrier the seller actually booked. Checkout no longer picks
            // one, and the buyer's tracking link is built from this.
            p_carrier_slug: event.carrierSlug,
            // Null until the carrier accepts, which is what tells the interface
            // there is nothing to link to yet.
            p_tracking_url: event.trackingUrl,
            // An order booked in one environment does not take events from the
            // other. Both accounts issue codes of the same shape, so without
            // this a sandbox rehearsal could march a real order to delivered.
            p_env: env,
        } as never);
        if (error) throw error;

        const result = data as { order_id?: string; status?: string; from_status?: string | null } | null;

        // Only a real transition earns an email. The RPC's early returns carry
        // no status, which is also what keeps GoShip's retries quiet.
        if (result?.order_id && result.status) {
            await notifyCarrierStatusChange(service, result as never);
        }

        // Some events end the order rather than advancing it: a parcel back
        // with the seller, or lost, will not become a delivery while its clock
        // runs down, so it goes to review now instead of in three days.
        if (event.terminalFailure && result?.order_id) {
            const { error: escalateError } = await service.rpc('escalate_order_to_dispute' as never, {
                p_order_id: result.order_id,
                p_reason: event.terminalFailure.reason,
                p_buyer_message: `${event.terminalFailure.reason} Đơn đang được quản trị viên kiểm tra. Tiền của bạn vẫn được giữ an toàn.`,
                p_seller_message: `${event.terminalFailure.reason} Quản trị viên sẽ kiểm tra trước khi xử lý.`,
            } as never);
            if (escalateError) throw escalateError;
        }

        return NextResponse.json({ success: true, result: data });
    } catch (error) {
        // Worth another go: GoShip will retry twice more.
        console.error('[GoShip Webhook] Failed:', error);
        return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
    }
}
