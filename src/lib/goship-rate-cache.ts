import 'server-only';
import { goshipEnv, goshipRates, type GoshipParcel, type GoshipRate } from '@/lib/goship';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * GoShip's answer for a route, remembered for ten minutes.
 *
 * The grid, the listing page, the cart and checkout all ask the same question
 * — what does this seller's parcel cost to this buyer's district — and a page
 * of fifty cards from a dozen shops would otherwise be a dozen round trips to
 * GoShip on every scroll. Kept in a table rather than in memory because the
 * app runs as serverless functions that share nothing.
 *
 * Booking never reads this. Rate ids expire, and the price booked must come
 * from the same round trip as the id handed back — see /api/shipping/book.
 */

const TTL_MS = 10 * 60 * 1000;

export type RateQuery = {
    from: { city: string; district: string };
    to: { city: string; district: string };
    parcel: GoshipParcel;
    declaredValue?: number;
};

const keyFor = (q: RateQuery) => [
    goshipEnv(),
    q.from.city, q.from.district,
    q.to.city, q.to.district,
    q.parcel.weight, q.parcel.width, q.parcel.height, q.parcel.length,
    Math.max(0, Math.round(q.declaredValue ?? 0)),
].join('|');

type Result = { ok: true; rates: GoshipRate[]; cached: boolean } | { ok: false; reason: string };

export async function cachedGoshipRates(query: RateQuery): Promise<Result> {
    const service = createServiceSupabaseClient();
    const key = keyFor(query);

    const hit = await service
        .from('goship_rate_cache' as never)
        .select('rates, expires_at')
        .eq('key', key)
        .maybeSingle();
    const row = hit.data as { rates: GoshipRate[]; expires_at: string } | null;
    if (row && Date.parse(row.expires_at) > Date.now() && Array.isArray(row.rates)) {
        return { ok: true, rates: row.rates, cached: true };
    }

    const fresh = await goshipRates(query);
    if (!fresh.ok) return fresh;

    // Empty answers are cached too: a route nobody serves is an answer, and
    // asking GoShip again every scroll does not change it. Awaited, because a
    // serverless function may be frozen the moment it answers and a write
    // still in flight is a write that never lands — which turns a ten-minute
    // cache into no cache at all on cold instances.
    const expires = new Date(Date.now() + TTL_MS).toISOString();
    const { error } = await service
        .from('goship_rate_cache' as never)
        .upsert({ key, rates: fresh.rates, expires_at: expires } as never);
    if (error) console.error('[RateCache] write failed:', error.message);
    // Opportunistic sweep, cheap on an indexed column; nothing waits on it.
    void service
        .from('goship_rate_cache' as never)
        .delete()
        .lt('expires_at', new Date().toISOString())
        .then(() => undefined);

    return { ok: true, rates: fresh.rates, cached: false };
}
