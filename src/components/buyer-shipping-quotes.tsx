'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUser } from '@/lib/supabase';
import { pickDefaultAddress, type SavedAddress } from '@/components/address-book';
import { fetchShippingOptionsBatch, type GoshipTo, type ShippingOption } from '@/lib/shipping-options-client';

/**
 * Real shipping prices for the cards on screen, against the buyer's address.
 *
 * A listing grid used to print a span from the seller's fee table. There is
 * no table now: the price is GoShip's, and GoShip needs both ends of the
 * route. So a signed-in buyer with a saved address sees the real number from
 * the grid onwards, and everybody else sees an invitation to add one — never a
 * guess, never a range.
 *
 * Cards register the parcel they would ship in — their seller and their own
 * listing id, so a slabbed card and a raw one from the same shop are priced
 * apart, the way checkout prices them. The provider batches everything on
 * screen into one request per animation frame, keyed on the buyer's default
 * address; the server collapses listings that share a route and parcel into
 * one GoShip call, so a page of one shop's raw cards still costs one quote.
 */

export type BuyerShippingState =
    | { status: 'signed_out' }
    | { status: 'needs_address' }
    | { status: 'loading' }
    | { status: 'ready'; cheapest: ShippingOption; count: number }
    | { status: 'error'; code: string };

/** One parcel to price: a seller and the listings going in it. */
export type ParcelAsk = { sellerId: string; cardIds: string[] };

type Entry = { status: 'loading' } | { status: 'ready'; options: ShippingOption[] } | { status: 'error'; code: string };

type Context = {
    to: GoshipTo | null;
    addressState: 'unknown' | 'signed_out' | 'none' | 'ready';
    subscribe: (ask: ParcelAsk) => void;
    entries: Record<string, Entry>;
};

const BuyerShippingContext = createContext<Context | null>(null);

export const askKey = (ask: ParcelAsk) => `${ask.sellerId}|${[...ask.cardIds].sort().join(',')}`;

export function BuyerShippingQuotesProvider({ children }: { children: ReactNode }) {
    const { user, isLoading } = useUser();
    const [address, setAddress] = useState<SavedAddress | null | 'loading'>('loading');
    // Quotes are only meaningful for the address they were priced to, so they
    // are filed under it; a new default address simply reads an empty file.
    const [store, setStore] = useState<{ toKey: string; map: Record<string, Entry> }>({ toKey: '', map: {} });
    const pending = useRef(new Map<string, ParcelAsk>());
    const frame = useRef<number | null>(null);

    const loadAddress = useCallback(async () => {
        if (!user) return;
        try {
            const res = await fetch('/api/shipping-addresses', { cache: 'no-store' });
            const body = await res.json().catch(() => null);
            const list: SavedAddress[] = res.ok ? (body?.addresses ?? []) : [];
            const chosen = pickDefaultAddress(Array.isArray(list) ? list : []);
            // A row from before addresses moved to GoShip's geography cannot
            // be quoted; treat it as no address so the buyer is asked to fix it.
            setAddress(chosen?.goship ? chosen : null);
        } catch {
            setAddress(null);
        }
    }, [user]);

    useEffect(() => {
        if (isLoading || !user) return;
        // Deferred a tick so the fetch does not start inside the render commit.
        const timer = window.setTimeout(() => void loadAddress(), 0);
        return () => window.clearTimeout(timer);
    }, [isLoading, user, loadAddress]);

    useEffect(() => {
        const reload = () => void loadAddress();
        window.addEventListener('cardverse:addresses-updated', reload);
        return () => window.removeEventListener('cardverse:addresses-updated', reload);
    }, [loadAddress]);

    const to = useMemo<GoshipTo | null>(() => (
        address && address !== 'loading' && address.goship ? { city: address.goship.city, district: address.goship.district } : null
    ), [address]);
    const toKey = to ? `${to.city}|${to.district}` : '';
    const entries = useMemo(() => (store.toKey === toKey ? store.map : {}), [store, toKey]);

    // Write under the current address, dropping whatever an older one filed.
    const file = useCallback((key: string, patch: Record<string, Entry>) => {
        setStore((prev) => ({ toKey: key, map: { ...(prev.toKey === key ? prev.map : {}), ...patch } }));
    }, []);

    const flush = useCallback(async (destination: GoshipTo) => {
        const key = `${destination.city}|${destination.district}`;
        const asks = [...pending.current.entries()];
        pending.current.clear();
        if (asks.length === 0) return;
        file(key, Object.fromEntries(asks.map(([id]) => [id, { status: 'loading' } as Entry])));
        try {
            const batch = await fetchShippingOptionsBatch({ to: destination, sellers: asks.map(([id, ask]) => ({ ...ask, key: id })) });
            file(key, Object.fromEntries(asks.map(([id]): [string, Entry] => {
                const failed = batch.errors[id];
                const options = batch.data[id] ?? [];
                return [id, failed
                    ? { status: 'error', code: failed.code }
                    : options.length ? { status: 'ready', options } : { status: 'error', code: 'seller_does_not_ship_here' }];
            })));
        } catch (error) {
            const code = (error as { code?: string })?.code || 'shipping_quote_failed';
            file(key, Object.fromEntries(asks.map(([id]) => [id, { status: 'error', code } as Entry])));
        }
    }, [file]);

    const subscribe = useCallback((ask: ParcelAsk) => {
        if (!to) return;
        pending.current.set(askKey(ask), ask);
        if (frame.current !== null) return;
        frame.current = window.requestAnimationFrame(() => {
            frame.current = null;
            void flush(to);
        });
    }, [to, flush]);

    // Signed out is known the moment auth settles; the address only matters
    // for someone who is signed in — otherwise `address` stays 'loading' for
    // ever and every label would spin instead of offering to sign in.
    const addressState: Context['addressState'] = isLoading ? 'unknown' : !user ? 'signed_out' : address === 'loading' ? 'unknown' : to ? 'ready' : 'none';

    const value = useMemo<Context>(() => ({ to, addressState, subscribe, entries }), [to, addressState, subscribe, entries]);
    return <BuyerShippingContext.Provider value={value}>{children}</BuyerShippingContext.Provider>;
}

function stateFor(ctx: Context | null, entry: Entry | undefined): BuyerShippingState {
    if (!ctx) return { status: 'needs_address' };
    if (ctx.addressState === 'signed_out') return { status: 'signed_out' };
    if (ctx.addressState === 'none') return { status: 'needs_address' };
    if (ctx.addressState === 'unknown' || !entry || entry.status === 'loading') return { status: 'loading' };
    if (entry.status === 'error') return { status: 'error', code: entry.code };
    return { status: 'ready', cheapest: entry.options[0], count: entry.options.length };
}

/**
 * Several parcels at once — the cart's total, one per seller with all of that
 * seller's cards. Keyed by askKey; the result is keyed the same way.
 */
export function useBuyerShippingQuotes(asks: ParcelAsk[]): Record<string, BuyerShippingState> {
    const ctx = useContext(BuyerShippingContext);
    const signature = asks.map(askKey).join(';');
    const subscribe = ctx?.subscribe;
    const ready = ctx?.addressState === 'ready';
    const entries = ctx?.entries;
    useEffect(() => {
        if (!ready || !subscribe) return;
        for (const ask of asks) if (!entries?.[askKey(ask)]) subscribe(ask);
    // `signature` stands in for `asks`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, signature, subscribe, entries]);

    return useMemo(
        () => Object.fromEntries(asks.map((ask) => [askKey(ask), stateFor(ctx, ctx?.entries[askKey(ask)])])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ctx, signature],
    );
}

/**
 * One listing's parcel, from the buyer's default address.
 *
 * Outside the provider (tests, isolated renders) it reports `needs_address`,
 * which renders as the invitation rather than a crash.
 */
export function useBuyerShippingQuote(sellerId: string | null | undefined, cardId?: string | null): BuyerShippingState {
    const asks = useMemo<ParcelAsk[]>(
        () => (sellerId ? [{ sellerId, cardIds: cardId ? [cardId] : [] }] : []),
        [sellerId, cardId],
    );
    const states = useBuyerShippingQuotes(asks);
    if (!sellerId) return { status: 'needs_address' };
    return states[askKey(asks[0])] ?? { status: 'loading' };
}

/** The buyer's default destination, for pages that quote themselves. */
export function useBuyerShippingDestination(): { to: GoshipTo | null; addressState: Context['addressState'] } {
    const ctx = useContext(BuyerShippingContext);
    return { to: ctx?.to ?? null, addressState: ctx?.addressState ?? 'unknown' };
}
