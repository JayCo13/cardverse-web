/**
 * Ask the server what one seller's parcel costs to this address.
 *
 * The browser never prices a parcel. Every surface that shows a buyer a
 * shipping figure — the one-click dialog, the listing page, the cart's
 * checkout — asks this, which asks `/api/shipping/options`, which calls the
 * same resolver that bills the order. So the number a buyer reads and the
 * number they are charged come from one piece of arithmetic, run once, on the
 * server.
 *
 * That was not always true: the one-click dialog used to read the listing row
 * itself and fall back to a constant when the listing had no fee of its own,
 * and it showed 25,000đ on a parcel the server then billed at something else.
 *
 * The options come back sorted cheapest first, and the cheapest is what the
 * buyer pays: nobody picks a carrier here. `quoteCheckoutConfiguredShippingBatch`
 * applies the identical rule server-side when an order arrives without a stated
 * carrier, so `[0]` is a preview of the real decision rather than a guess at it.
 */

export type ShippingOption = { carrier: string; fee: number };

/**
 * A refusal the caller is expected to show, not to log.
 *
 * `code` is the server's own — `seller_does_not_ship_here`,
 * `seller_shipping_origin_missing`, `shipping_quote_failed` — because the
 * distinctions matter to a buyer: one is "this seller cannot reach you", the
 * next is "this seller is not set up", the last is "try again".
 */
export class ShippingOptionsError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = 'ShippingOptionsError';
    }
}

export async function fetchShippingOptions(input: {
    toProvinceId: number;
    toProvinceName: string;
    sellerId: string;
    /**
     * The listings going in this parcel. One per listing, even for a bundle —
     * a bundle is one listing and ships as one parcel, which is exactly what
     * /api/marketplace/buy quotes.
     */
    cardIds: string[];
    signal?: AbortSignal;
}): Promise<ShippingOption[]> {
    const response = await fetch('/api/shipping/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
        body: JSON.stringify({
            toProvinceId: input.toProvinceId,
            toProvinceName: input.toProvinceName,
            sellers: [{ sellerId: input.sellerId, cardIds: input.cardIds }],
        }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ShippingOptionsError(payload?.code || 'shipping_quote_failed');

    const options: ShippingOption[] = payload?.data?.[input.sellerId] ?? [];
    // An empty list is a refusal too, and the honest one to report: the seller
    // offers nothing that can reach this address.
    if (options.length === 0) throw new ShippingOptionsError('seller_does_not_ship_here');
    return options;
}

/** The carrier a buyer gets when nobody chooses: the cheapest one offered. */
export const cheapestShippingFee = (options: ShippingOption[]): number => options[0].fee;
