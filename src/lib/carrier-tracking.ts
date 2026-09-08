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
    lang: string | null = DEFAULT_TRACKING_LANG,
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
            // `translation_mode` only means anything alongside `lang`, and only
            // here — this is the one call that decides how the parcel's prose
            // will read for the rest of its life.
            body: JSON.stringify([{
                number: trackingNumber,
                carrier: carrierCode,
                ...(lang ? { lang, translation_mode: 'UseThirdPartyServices' } : {}),
            }]),
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
    /** The carrier's own wording, in whatever language the carrier publishes. */
    description: string | null;
    /**
     * The service's translation and the language it is in, fixed when the
     * parcel was registered. The reader's language may not be this one, which
     * is why the caller compares before using it.
     */
    translation: { lang: string; description: string } | null;
    location: string | null;
    stage: string | null;
};

/**
 * App locale → the language 17TRACK writes its event descriptions in.
 *
 * The one thing to know: **`lang` belongs to `register`, not to
 * `gettrackinfo`.** Sending it on the read does nothing at all — verified with
 * vi, en and ja, and with translation_mode set as well; every response came
 * back identical English with no `description_translation` field. Sent on
 * registration it works, and the field appears:
 *
 *   register {lang: 'vi'}                              -> {"lang":"vi","description":"Sender is preparing…"}
 *   register {lang: 'vi', translation_mode: 3rd party} -> {"lang":"vi","description":"Người gửi đang chuẩn bị gửi bưu kiện của bạn"}
 *
 * Both parts are needed: `lang` alone only asks the carrier for its own
 * official wording, which SPX and GHN publish in English, so the translation
 * comes back untranslated. The third-party mode is what actually renders it,
 * and it is the same thing the 17TRACK dashboard's "Translate" checkbox does.
 * It costs no extra quota beyond the one the registration already spends.
 *
 * The consequence to design around: a parcel is registered once, at ship time,
 * so its prose has ONE language for everyone who later looks at it. It cannot
 * follow the reader. That is why each event still carries its `stage`, and why
 * the dialog falls back to translating that enum for anyone whose language does
 * not match `description_translation.lang`.
 */
const TRACKING_LANGS: Record<string, string> = {
    'vi-VN': 'vi',
    'en-US': 'en',
    'ja-JP': 'ja',
};

export const trackingLang = (locale: string | null | undefined): string | null =>
    (locale && TRACKING_LANGS[locale]) || null;

/**
 * The language parcels are registered in.
 *
 * Vietnamese, because the platform ships inside Vietnam only and both parties
 * on an order are reading Vietnamese in almost every case. Readers of the other
 * two languages are not stranded: they get the translated `stage` instead of
 * prose in a language they did not ask for. If delivery ever crosses a border,
 * pass the buyer's own locale here instead of this constant.
 */
export const DEFAULT_TRACKING_LANG = 'vi';

/**
 * The translation on an event, or null when there is none.
 *
 * Live shape, from a parcel registered with a language:
 *   {"lang": "vi", "description": "Người gửi đang chuẩn bị gửi bưu kiện của bạn"}
 *
 * A parcel registered without one has no `description_translation` key at all,
 * so null here is the normal case for anything shipped before this was set.
 * A bare string is still accepted in case the shape ever changes back.
 */
function eventTranslation(event: Record<string, any>): { lang: string; description: string } | null {
    const raw = event?.description_translation;
    if (typeof raw === 'string' && raw.trim()) return { lang: '', description: raw };
    if (raw && typeof raw === 'object') {
        const text = raw.description ?? raw.text ?? raw.content;
        if (typeof text === 'string' && text.trim()) {
            return { lang: typeof raw.lang === 'string' ? raw.lang : '', description: text };
        }
    }
    return null;
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
/**
 * Current status for many parcels in one call.
 *
 * `gettrackinfo` takes an array — the single-parcel read above already sends
 * one — so refreshing a page of orders costs one request rather than one per
 * order, which is what makes it affordable to do on every orders fetch.
 *
 * Unlike that read, this one is bounded: it runs inside a request that has a
 * function timeout to answer within, and an upstream that hangs must cost the
 * refresh rather than the page. Returns only what came back, keyed by the
 * number 17TRACK echoed — which is upper case, hence the normalising at the
 * call site.
 */
export async function fetchCarrierTrackingBatch(
    items: Array<{ carrier: string; trackingNumber: string }>,
    timeoutMs = 4_000,
): Promise<Map<string, { status: string; subStatus: string | null }>> {
    const out = new Map<string, { status: string; subStatus: string | null }>();
    const apiKey = process.env.SEVENTEENTRACK_API_KEY;
    if (!apiKey || items.length === 0) return out;

    // 17TRACK caps a batch at 40. Anything past that is dropped rather than
    // split into a second request: this runs on a page load, and a caller with
    // more than forty parcels in flight is better served by the webhook.
    const payload = items
        .map(({ carrier, trackingNumber }) => ({ number: trackingNumber, carrier: CARRIER_CODES[carrier] }))
        .filter((entry) => !!entry.carrier && !!entry.number)
        .slice(0, 40);
    if (payload.length === 0) return out;

    try {
        const response = await fetch(`${API_BASE}/gettrackinfo`, {
            method: 'POST',
            headers: { '17token': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.json();
        for (const item of body?.data?.accepted ?? []) {
            const number = item?.number;
            const status = item?.track_info?.latest_status?.status;
            if (!number || !status) continue;
            out.set(String(number).toUpperCase(), {
                status,
                subStatus: item?.track_info?.latest_status?.sub_status || null,
            });
        }
    } catch (error) {
        // A refresh that fails is a refresh that did not happen. The caller
        // still has whatever the last webhook left behind.
        console.warn('[Tracking] Batch refresh failed:', error);
    }
    return out;
}

export async function fetchCarrierTracking(
    carrier: string,
    trackingNumber: string,
): Promise<TrackingLookup> {
    const apiKey = process.env.SEVENTEENTRACK_API_KEY;
    const carrierCode = CARRIER_CODES[carrier];
    if (!apiKey) return { ok: false, reason: 'not_configured' };
    if (!carrierCode || !trackingNumber) return { ok: false, reason: 'not_trackable' };

    try {
        const response = await fetch(`${API_BASE}/gettrackinfo`, {
            method: 'POST',
            headers: { '17token': apiKey, 'Content-Type': 'application/json' },
            // No `lang` here on purpose: this endpoint ignores it. The
            // language was decided at registration; see TRACKING_LANGS.
            body: JSON.stringify([{ number: trackingNumber, carrier: carrierCode }]),
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
                description: e?.description || null,
                translation: eventTranslation(e),
                location: e?.location || null,
                stage: e?.stage || null,
            })),
        };
    } catch {
        return { ok: false, reason: 'unavailable' };
    }
}
