import 'server-only';

/**
 * Delivery status from a multi-carrier tracking service (17TRACK).
 *
 * Sellers book their own shipments on the carrier's system, and every carrier
 * webhook is scoped to the account that booked the parcel — so the carriers
 * themselves can never tell us that a seller's parcel arrived. A tracking
 * aggregator is the only source that works across accounts, and one source
 * answers for every carrier at once.
 *
 * Registering a number costs one quota, once. After that the service follows
 * the parcel and pushes status to our webhook for free, until 30 days pass with
 * no carrier event or 15 days after delivery settles — both far outside the 72h
 * window the platform actually cares about.
 */

const API_BASE = 'https://api.17track.net/track/v2.4';

/**
 * Our carrier codes → 17TRACK's numeric ones.
 *
 * `vtp` is deliberately absent. Viettel Post appears in 17TRACK's carrier list
 * but its API refuses registration with `-18019911 "The carrier temporarily
 * does not support registration"` — verified twice against the live API. Until
 * that changes, Viettel Post orders carry no automated signal, which the
 * dispute verdict already reports honestly as 'unverified' rather than guessing.
 *
 * `self` is hand delivery: there is no parcel and no carrier to ask.
 */
const CARRIER_CODES: Record<string, number> = {
    ghn: 100593,
    shopee: 100538,
};

export const trackableCarrier = (code: string | null | undefined): boolean =>
    !!code && code in CARRIER_CODES;

/** 17TRACK's nine main statuses. */
export type CarrierStatus =
    | 'NotFound' | 'InfoReceived' | 'InTransit' | 'Expired' | 'AvailableForPickup'
    | 'OutForDelivery' | 'DeliveryFailure' | 'Delivered' | 'Exception';

/**
 * Register a tracking number so the service starts following it.
 *
 * Best-effort by contract: the caller has already handed the parcel over, and a
 * tracking-service outage must never be what stops a seller from shipping.
 * Returns whether registration took, so the caller can log it and move on.
 */
export async function registerCarrierTracking(
    carrier: string,
    trackingNumber: string,
): Promise<{ registered: boolean; reason?: string }> {
    const apiKey = process.env.SEVENTEENTRACK_API_KEY;
    const carrierCode = CARRIER_CODES[carrier];
    if (!apiKey) return { registered: false, reason: 'api_key_missing' };
    if (!carrierCode) return { registered: false, reason: 'carrier_not_trackable' };
    if (!trackingNumber) return { registered: false, reason: 'no_tracking_number' };

    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { '17token': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ number: trackingNumber, carrier: carrierCode }]),
        });
        const payload = await response.json();
        const rejected = payload?.data?.rejected;
        if (Array.isArray(rejected) && rejected.length > 0) {
            return { registered: false, reason: rejected[0]?.error?.message || 'rejected' };
        }
        const accepted = payload?.data?.accepted;
        if (Array.isArray(accepted) && accepted.length > 0) return { registered: true };
        return { registered: false, reason: payload?.message || 'unexpected_response' };
    } catch (error) {
        return { registered: false, reason: (error as Error)?.message || 'request_failed' };
    }
}

/**
 * Pull the number, carrier and status out of a push payload.
 *
 * Shaped from a live `gettrackinfo` response rather than from the docs, which
 * do not spell the nesting out. The webhook wraps the same object, so both the
 * `data.accepted[]` array and a bare `data` object are accepted.
 */
export function readTrackingEvent(body: unknown): {
    number: string;
    carrier: number | null;
    status: string;
    subStatus: string | null;
} | null {
    const data = (body as Record<string, any>)?.data;
    const item = Array.isArray(data?.accepted) ? data.accepted[0] : data;
    if (!item || typeof item !== 'object') return null;

    const number = typeof item.number === 'string' ? item.number.trim() : '';
    const status = item?.track_info?.latest_status?.status;
    if (!number || typeof status !== 'string' || !status) return null;

    return {
        number,
        carrier: typeof item.carrier === 'number' ? item.carrier : null,
        status,
        subStatus: typeof item?.track_info?.latest_status?.sub_status === 'string'
            ? item.track_info.latest_status.sub_status
            : null,
    };
}

export type TrackingEvent = {
    time: string | null;
    description: string | null;
    location: string | null;
    stage: string | null;
};

/**
 * The parcel's journey, as the tracking service currently has it.
 *
 * Read-only and safe to call on demand: `gettrackinfo` costs no quota, only
 * `register` does. Returns null when the carrier is one we never registered
 * (Viettel Post, hand delivery), so the caller can say so rather than showing
 * an empty timeline that looks like a failure.
 */
export async function fetchCarrierTracking(
    carrier: string,
    trackingNumber: string,
): Promise<{ status: string; subStatus: string | null; events: TrackingEvent[] } | null> {
    const apiKey = process.env.SEVENTEENTRACK_API_KEY;
    const carrierCode = CARRIER_CODES[carrier];
    if (!apiKey || !carrierCode || !trackingNumber) return null;

    try {
        const response = await fetch(`${API_BASE}/gettrackinfo`, {
            method: 'POST',
            headers: { '17token': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ number: trackingNumber, carrier: carrierCode }]),
        });
        const payload = await response.json();
        const item = payload?.data?.accepted?.[0];
        if (!item) return null;

        const info = item.track_info || {};
        const provider = info?.tracking?.providers?.[0];
        const rawEvents = Array.isArray(provider?.events) ? provider.events : [];
        return {
            status: info?.latest_status?.status || 'NotFound',
            subStatus: info?.latest_status?.sub_status || null,
            events: rawEvents.map((e: Record<string, any>) => ({
                time: e?.time_utc || e?.time_iso || null,
                description: e?.description || null,
                location: e?.location || null,
                stage: e?.stage || null,
            })),
        };
    } catch {
        return null;
    }
}
