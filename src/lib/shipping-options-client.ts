/**
 * The browser's one way to learn what shipping costs.
 *
 * Every buyer-facing figure — grid, listing page, cart, both checkouts — comes
 * from POST /api/shipping/options, which prices the parcel with GoShip the same
 * way the order routes bill it. The browser never adds, rounds or estimates a
 * fee of its own: it shows what came back, and sends back the carrier code the
 * buyer picked.
 *
 * Options arrive cheapest first, so `[0]` is the default selection and what a
 * path with no picker (paying an accepted offer) is charged.
 */

import type { ParcelPreset } from '@/lib/parcel';

export type GoshipTo = { city: string; district: string };

export type ShippingOption = {
    carrier: string;
    /** What the buyer pays, rounded up to the thousand. */
    fee: number;
    feeRaw: number;
    rateId: string | null;
    expected: string | null;
    successPercent: number | null;
    parcelPreset: ParcelPreset;
    /** Seller-priced listing: one option, no carrier choice. */
    listingOverride: boolean;
};

/**
 * A refusal the caller is expected to show, not to log.
 *
 * `code` is the server's own — `seller_does_not_ship_here`,
 * `seller_shipping_origin_missing`, `shipping_quote_failed`,
 * `shipping_address_invalid` — because the distinctions matter to a buyer.
 */
export class ShippingOptionsError extends Error {
    constructor(public readonly code: string, public readonly sellerId?: string) {
        super(code);
        this.name = 'ShippingOptionsError';
    }
}

export type ShippingOptionsBatch = {
    data: Record<string, ShippingOption[]>;
    errors: Record<string, { code: string; seller_name: string | null }>;
};

/** Several sellers at once — the grid, the cart, the cart checkout. */
export async function fetchShippingOptionsBatch(input: {
    to: GoshipTo;
    /** `key` names the answer when one seller is asked about several listings; defaults to the seller id. */
    sellers: { sellerId: string; cardIds: string[]; key?: string }[];
    signal?: AbortSignal;
}): Promise<ShippingOptionsBatch> {
    const response = await fetch('/api/shipping/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
        body: JSON.stringify({ to: input.to, sellers: input.sellers }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ShippingOptionsError(payload?.code || 'shipping_quote_failed', payload?.seller_id);
    return { data: payload?.data ?? {}, errors: payload?.errors ?? {} };
}

/** One seller — the one-click dialog and the listing page. */
export async function fetchShippingOptions(input: {
    to: GoshipTo;
    sellerId: string;
    /** The listings going in this parcel; a bundle is one listing. */
    cardIds: string[];
    signal?: AbortSignal;
}): Promise<ShippingOption[]> {
    const batch = await fetchShippingOptionsBatch({ to: input.to, sellers: [{ sellerId: input.sellerId, cardIds: input.cardIds }], signal: input.signal });
    const failed = batch.errors[input.sellerId];
    if (failed) throw new ShippingOptionsError(failed.code, input.sellerId);
    const options = batch.data[input.sellerId] ?? [];
    // An empty list is a refusal too, and the honest one to report: the seller
    // offers nothing that can reach this address.
    if (options.length === 0) throw new ShippingOptionsError('seller_does_not_ship_here', input.sellerId);
    return options;
}
