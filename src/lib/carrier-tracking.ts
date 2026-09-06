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
 * App locale → the language 17TRACK is asked to write event descriptions in.
 *
 * Read this before relying on it: **as of 2026-09-06 it changes nothing.** The
 * live API was called for SPXVN069266737329 with lang vi, en and ja, and once
 * more with translation_mode 'UseThirdPartyServices', and every response came
 * back with the identical English `description` and no `description_translation`
 * field anywhere in the payload. `lang` is documented and the three codes are
 * on the supported list, so the parameter is kept and costs nothing — but the
 * timeline is translated from the `stage` enum in the dialog, not from this.
 */
const TRACKING_LANGS: Record<string, string> = {
    'vi-VN': 'vi',
    'en-US': 'en',
    'ja-JP': 'ja',
};

export const trackingLang = (locale: string | null | undefined): string | null =>
    (locale && TRACKING_LANGS[locale]) || null;

/**
 * The event text, preferring a translation if one ever appears.
 *
 * No response observed so far carries `description_translation` at all — the
 * live event keys are address, description, location, stage, sub_status,
 * time_iso, time_raw and time_utc. This reads it defensively anyway, as a bare
 * string or an object, because it is documented and costs three lines; every
 * real response falls straight through to the carrier's own wording.
 */
function eventDescription(event: Record<string, any>): string | null {
    const translated = event?.description_translation;
    if (typeof translated === 'string' && translated.trim()) return translated;
    if (translated && typeof translated === 'object') {
        const nested = translated.description ?? translated.text ?? translated.content;
        if (typeof nested === 'string' && nested.trim()) return nested;
    }
    return event?.description || null;
}

/**
 * Why a lookup produced nothing. Kept apart from "the parcel has not moved
 * yet", because the two look identical to a caller holding an empty array and
 * only one of them is the carrier's doing.
 *
 * `not_registered` is the one worth watching: the service answers it for a
 * number nobody ever registered, and also for one whose registration has gone
 * away. It happened to a live order on 2026-09-05, and until the number is
 * registered again no webhook will ever fire for it, so the order can never
 * settle on the delivery path.
 */
export type TrackingLookupFailure =
    | 'not_configured'
    | 'not_trackable'
    | 'not_registered'
    | 'unavailable';

export type TrackingLookup =
    | { ok: true; status: string; subStatus: string | null; events: TrackingEvent[] }
    | { ok: false; reason: TrackingLookupFailure };

/** 17TRACK's code for "this number was never registered". */
const NOT_REGISTERED_CODE = -18019902;

/**
 * The parcel's journey, as the tracking service currently has it.
 *
 * Read-only and safe to call on demand: `gettrackinfo` costs no quota, only
 * `register` does.
 *
 * Never collapses a failure into an empty result. An unset API key, a number
 * the service is not following, and an outage all used to come back as `null`,
 * which the route turned into `events: []` and the dialog rendered as "the
 * carrier has no updates yet" — blaming the carrier for our own missing
 * configuration. The caller gets the reason and can say something true.
 */
export async function fetchCarrierTracking(
    carrier: string,
    trackingNumber: string,
    lang?: string | null,
): Promise<TrackingLookup> {
    const apiKey = process.env.SEVENTEENTRACK_API_KEY;
    const carrierCode = CARRIER_CODES[carrier];
    if (!apiKey) return { ok: false, reason: 'not_configured' };
    if (!carrierCode || !trackingNumber) return { ok: false, reason: 'not_trackable' };

    try {
        const response = await fetch(`${API_BASE}/gettrackinfo`, {
            method: 'POST',
            headers: { '17token': apiKey, 'Content-Type': 'application/json' },
            // `lang` sits beside `number` and `carrier`, and is omitted when
            // the reader's language is not one we map. It is sent in hope
            // rather than expectation: see TRACKING_LANGS for the live test
            // showing it currently has no effect. `translation_mode` is left at
            // its default, having been tried and made no difference either.
            body: JSON.stringify([{ number: trackingNumber, carrier: carrierCode, ...(lang ? { lang } : {}) }]),
        });
        const payload = await response.json();
        const item = payload?.data?.accepted?.[0];
        if (!item) {
            // A rejection carries a reason; an empty response does not.
            const rejected = payload?.data?.rejected?.[0]?.error;
            if (rejected?.code === NOT_REGISTERED_CODE) return { ok: false, reason: 'not_registered' };
            return { ok: false, reason: 'unavailable' };
        }

        const info = item.track_info || {};
        const provider = info?.tracking?.providers?.[0];
        const rawEvents = Array.isArray(provider?.events) ? provider.events : [];
        return {
            ok: true,
            status: info?.latest_status?.status || 'NotFound',
            subStatus: info?.latest_status?.sub_status || null,
            events: rawEvents.map((e: Record<string, any>) => ({
                time: e?.time_utc || e?.time_iso || null,
                description: eventDescription(e),
                location: e?.location || null,
                stage: e?.stage || null,
            })),
        };
    } catch {
        return { ok: false, reason: 'unavailable' };
    }
}
