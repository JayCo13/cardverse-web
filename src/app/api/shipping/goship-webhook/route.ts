import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Status pushes from GoShip.
 *
 * Deliberately inert. GoShip publishes no webhook reference — doc.goship.io
 * 404s on the page its own homepage links to — so the payload's shape and its
 * vocabulary of statuses are both unknown, and a parser written from a guess
 * would be deciding when to release a seller's money. This records what
 * arrives; wiring it to apply_carrier_tracking_event comes after a real push
 * has been read.
 *
 * Security: assume no signature, because the sibling 17TRACK webhook taught us
 * not to assume one. The URL therefore carries a secret compared in constant
 * time, and the route fails closed when that secret is unset — an absent token
 * must never mean an open door. Any signature header GoShip does send is logged
 * below, and this can move to verifying it once we know it exists.
 */

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Fields that would put a buyer's name, phone or street into a log. */
const PII = /name|phone|address|street|email|receiver|sender|note|description/i;

/**
 * The shape of a payload, without its contents.
 *
 * Enough to write a parser against — every key, nested, with the type it holds
 * and short scalar values kept because a status code is exactly that. Anything
 * that could be a person's details is reported as its type alone: this runs on
 * real orders, and discovering a format is not a reason to copy customers into
 * a log file.
 */
function describe(value: unknown, key = '', depth = 0): unknown {
    if (depth > 4) return '…';
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.length === 0 ? [] : [describe(value[0], key, depth + 1), `…×${value.length}`];
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .map(([k, v]) => [k, describe(v, k, depth + 1)]),
        );
    }
    if (PII.test(key)) return `<${typeof value}>`;
    if (typeof value === 'string') return value.length <= 60 ? value : `<string:${value.length}>`;
    return value;
}

export async function POST(request: NextRequest) {
    const expected = process.env.GOSHIP_WEBHOOK_TOKEN;
    if (!expected) {
        console.error('[GoShip Webhook] GOSHIP_WEBHOOK_TOKEN is not set — rejecting');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 });
    }

    const provided = request.nextUrl.searchParams.get('token')
        || request.headers.get('x-webhook-token')
        || '';
    // Fixed-length digests so a length mismatch cannot throw or leak timing.
    if (!timingSafeEqual(sha256(provided), sha256(expected))) {
        console.warn('[GoShip Webhook] Invalid token');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        // Header names are what tell us whether a signature exists at all.
        const headers = Object.fromEntries(
            [...request.headers.entries()]
                .filter(([k]) => !/^(cookie|authorization)$/i.test(k))
                .map(([k, v]) => [k, /sign|hmac|hash|digest/i.test(k) ? v : `<${v.length} chars>`]),
        );

        // warn, not log: this is a temporary diagnostic and stdout is
        // block-buffered when piped to a file, which hides it exactly when
        // someone is watching for it.
        console.warn('[GoShip Webhook] shape:', JSON.stringify(describe(body)));
        console.warn('[GoShip Webhook] headers:', JSON.stringify(headers));
    } catch (error) {
        console.error('[GoShip Webhook] Unreadable payload:', error);
    }

    // Always 200. Nothing here can fail in a way a retry would fix, and a
    // provider that retries a push we already recorded gains nothing.
    return NextResponse.json({ success: true, recorded: true });
}
