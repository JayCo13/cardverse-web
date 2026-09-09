/**
 * GoShip — multi-carrier shipment booking for Vietnam.
 *
 * Where 17TRACK only watches a parcel somebody else booked, GoShip books it.
 * That difference is the point: a shipment created here has a tracking number
 * we issued, on a carrier we chose, with webhooks addressed to us — none of
 * which is true of a number a seller types into a form.
 *
 * Everything below was read off the live API rather than off documentation,
 * because the reference was not found at first. It does exist, under
 * doc.goship.io/api/shipment/*, and it says one thing the responses do not:
 * creating a shipment "returns HTTP 200 OK regardless of failure", with the
 * real outcome arriving later by webhook. A 200 here is therefore an
 * acknowledgement, not a booking.
 *
 * Where a shape is asserted below, it was confirmed by calling the endpoint;
 * where it was not, the function says so.
 */

const BASE_URL = 'https://api.goship.io/api/v2';

/**
 * The live token. Sandbox is a real environment — sandbox.goship.io answers,
 * and every example in the documentation is written against it — but it
 * rejects this token, so it takes credentials of its own that we do not have.
 * Until then every test booking here is a real waybill.
 */
const token = () => process.env.GOSHIP_API?.trim() || '';

export type GoshipAddress = {
    /** GoShip's own ids, from cities/districts/wards — not the app's. */
    city: string;
    district: string;
    ward: string;
    street: string;
    name: string;
    phone: string;
};

/** Grams and centimetres. A slabbed card in a bubble mailer is ~100g. */
export type GoshipParcel = {
    weight: number;
    width: number;
    height: number;
    length: number;
};

export type GoshipRate = {
    /** Opaque token to hand back as `shipment.rate`. Not a carrier id. */
    id: string;
    carrierName: string;
    /** `shopee`, `vtp`, `ghnv3`, … — GoShip's code, not ours. */
    carrierCode: string;
    service: string;
    /** VND, already including GoShip's fees. */
    totalFee: number;
    expected: string | null;
    /** Carrier's own delivery success rate, when GoShip reports it. */
    successPercent: number | null;
};

/**
 * GoShip carrier codes to the ones the app already stores.
 *
 * GHN is `ghnv3` there and `ghn` here; the other two happen to agree. Anything
 * unmapped is returned as-is and simply will not match a carrier the app knows,
 * which is the safe direction to fail in.
 */
const CARRIER_CODE_TO_APP: Record<string, string> = {
    ghnv3: 'ghn',
    vtp: 'vtp',
    shopee: 'shopee',
};

export const goshipCarrierToApp = (code: string): string => CARRIER_CODE_TO_APP[code] ?? code;

type GoshipEnvelope<T> = { code?: number; status?: string; data?: T; message?: string };

async function call<T>(
    path: string,
    init: {
        method?: 'GET' | 'POST';
        body?: unknown;
        timeoutMs?: number;
        /**
         * Read the answer from the root of the response instead of `data`.
         *
         * Creating a shipment returns both: an envelope with `data` set to an
         * empty array, and the shipment's own fields beside it. Guessing from
         * the shape does not work — `data: []` is also what an empty list looks
         * like — so the caller says which it expects.
         */
        root?: boolean;
    } = {},
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
    const bearer = token();
    if (!bearer) return { ok: false, reason: 'not_configured' };

    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: init.method ?? 'GET',
            headers: {
                Authorization: `Bearer ${bearer}`,
                Accept: 'application/json',
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(init.body ? { body: JSON.stringify(init.body) } : {}),
            // Bounded on purpose: these run inside request handlers that
            // Netlify kills at ten seconds.
            signal: AbortSignal.timeout(init.timeoutMs ?? 6_000),
        });

        const payload = (await response.json()) as GoshipEnvelope<T>;
        if (!response.ok || (payload.code && payload.code >= 400)) {
            // Validation errors arrive as an object of field -> messages, or a
            // bare array. Flatten either into something a log can carry.
            const raw = payload.data ?? payload.message;
            const detail = typeof raw === 'string'
                ? raw
                : JSON.stringify(raw ?? {}).slice(0, 300);
            return { ok: false, reason: detail || `http_${response.status}` };
        }
        return { ok: true, data: (init.root ? payload : payload.data) as T };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'request_failed' };
    }
}

/** GoShip's own geography, three levels deep. See the note in goshipRates. */
export const goshipCities = () =>
    call<Array<{ id: string; name: string }>>('/cities');

export const goshipDistricts = (cityId: string) =>
    call<Array<{ id: string; name: string }>>(`/cities/${encodeURIComponent(cityId)}/districts`);

export const goshipWards = (districtId: string) =>
    call<Array<{ id: number; name: string }>>(`/districts/${encodeURIComponent(districtId)}/wards`);

/**
 * What the carriers would charge for this parcel, cheapest first.
 *
 * Only city and district are consulted for a quote — ward and street are not
 * required until the shipment is actually booked — so this can be quoted from
 * an address the seller has not finished typing.
 *
 * The addresses are GoShip's ids, and they are NOT the app's. GoShip still
 * models Vietnam as 63 provinces with a district level; the app's own data is
 * the 2025 structure, 34 provinces and no districts at all. Ho Chi Minh City
 * now contains wards called Bà Rịa and Vũng Tàu, which GoShip still files under
 * a separate province — so translating one to the other by name puts a parcel
 * in the wrong city. Callers must supply GoShip ids that came from the three
 * functions above.
 */
export async function goshipRates(input: {
    from: Pick<GoshipAddress, 'city' | 'district'>;
    to: Pick<GoshipAddress, 'city' | 'district'>;
    parcel: GoshipParcel;
    /**
     * Declared value, in VND. Carriers charge for it above a threshold — SPX a
     * flat 25,000đ, GHN half a percent — so a quote taken without it is not the
     * price of a booking made with it.
     */
    declaredValue?: number;
}): Promise<{ ok: true; rates: GoshipRate[] } | { ok: false; reason: string }> {
    type Raw = {
        id: string;
        carrier_name?: string;
        carrier_short_name?: string;
        service?: string;
        total_fee?: number;
        expected?: string;
        report?: { success_percent?: number };
    };

    const result = await call<Raw[]>('/rates', {
        method: 'POST',
        body: {
            shipment: {
                address_from: { city: input.from.city, district: input.from.district },
                address_to: { city: input.to.city, district: input.to.district },
                parcel: {
                    ...input.parcel,
                    cod: 0,
                    amount: Math.max(0, Math.round(input.declaredValue ?? 0)),
                },
            },
        },
    });
    if (!result.ok) return result;

    const rates = (result.data ?? []).map((r) => ({
        id: r.id,
        carrierName: r.carrier_name ?? '',
        carrierCode: goshipCarrierToApp(r.carrier_short_name ?? ''),
        service: r.service ?? '',
        totalFee: Number(r.total_fee ?? 0),
        expected: r.expected ?? null,
        successPercent: typeof r.report?.success_percent === 'number' ? r.report.success_percent : null,
    })).sort((a, b) => a.totalFee - b.totalFee);

    return { ok: true, rates };
}

/**
 * Book the parcel.
 *
 * `rate` is the opaque id from goshipRates, not a carrier code — passing a
 * carrier code is answered with "Thiếu thông tin dịch vụ và hãng vận chuyển",
 * and passing an unknown id with "Không tìm thấy dịch vụ phù hợp". Quotes go
 * stale, so re-quote rather than storing an id for later.
 *
 * `declaredValue` is sent as `parcel.amount` — khai giá, the figure a carrier
 * pays out when a parcel is lost, and the one the API reference names.
 *
 * It has a price. Above a threshold the carrier charges for it, and the
 * threshold and the rate are the carrier's own: SPX adds a flat 25,000đ over
 * roughly two million, GHN charges half a percent with no flat step. So a quote
 * taken without a declared value is not the price of a booking made with one,
 * which is why goshipRates takes it too.
 *
 * Required rather than optional: a parcel booked at zero is one the carrier
 * owes nothing for, and that should be a decision somebody wrote down.
 *
 * `orderId` rides along as GoShip's `order_id`. If their webhook echoes it, an
 * event identifies its order outright instead of being matched on a tracking
 * number — which is the whole class of bug that has three orders on this
 * database sharing one number today.
 *
 * `payer: 1` is the sender. The buyer has already paid shipping into escrow, so
 * the parcel must not arrive asking them for it again.
 *
 * This is the one call here that costs money and sends a courier to a seller's
 * door. Nothing calls it yet.
 */
export type GoshipCreatedShipment = {
    /** GoShip's own code — the key their webhooks are matched on. */
    id?: string;
    /** The carrier's own number, available immediately rather than on a push. */
    tracking_number?: string;
    /** GoShip's carrier code, e.g. `ghnv3`. */
    carrier_short_name?: string;
    shipment_status?: number;
};

export async function goshipCreateShipment(input: {
    from: GoshipAddress;
    to: GoshipAddress;
    parcel: GoshipParcel;
    rateId: string;
    /** VND. What the carrier owes if the parcel never arrives. */
    declaredValue: number;
    /** Our own order id, echoed back on GoShip's events if they carry it. */
    orderId?: string;
    /** Handling instructions printed for the courier. */
    note?: string;
}) {
    return call<GoshipCreatedShipment>('/shipments', {
        // The shipment comes back at the root, beside an empty `data`.
        root: true,
        method: 'POST',
        body: {
            shipment: {
                address_from: input.from,
                address_to: input.to,
                parcel: {
                    ...input.parcel,
                    // Never collect on delivery: everything here is paid before
                    // the parcel moves, and a courier asking for money again
                    // would be charging twice.
                    cod: 0,
                    amount: Math.max(0, Math.round(input.declaredValue)),
                    ...(input.note ? { metadata: input.note } : {}),
                },
                rate: input.rateId,
                payer: 1,
                ...(input.orderId ? { order_id: input.orderId } : {}),
            },
        },
        timeoutMs: 9_000,
    });
}

/**
 * The shipment already booked against one of our orders, if there is one.
 *
 * Creating a shipment is not idempotent and the call is not reliable: GoShip
 * can accept a booking and answer slower than the function is allowed to wait,
 * leaving a real parcel upstream and an order that knows nothing about it. That
 * is what order_id is for — it is our id, echoed back, and it is the only way
 * to recognise our own shipment after the answer was lost.
 *
 * Filtered here as well as in the query string: the parameter may or may not be
 * honoured, and a wrong match would attach somebody else's parcel to this
 * order.
 */
export async function goshipFindShipmentByOrderId(orderId: string) {
    const result = await call<Array<Record<string, unknown>>>(
        `/shipments?order_id=${encodeURIComponent(orderId)}`,
        { timeoutMs: 5_000 },
    );
    if (!result.ok) return result;
    const match = (result.data ?? []).find((row) => row?.order_id === orderId) ?? null;
    return { ok: true as const, data: match as GoshipCreatedShipment | null };
}

/**
 * Point GoShip's status pushes at us. Idempotent from our side only in that
 * listing first shows what is already registered — GoShip does not de-duplicate.
 */
export const goshipListWebhooks = () => call<Array<Record<string, unknown>>>('/webhooks');

export const goshipRegisterWebhook = (endpoint: string) =>
    call<Record<string, unknown>>('/webhooks', { method: 'POST', body: { endpoint } });
