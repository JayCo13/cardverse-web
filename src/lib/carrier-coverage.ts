import 'server-only';
import { goshipCities, goshipDistricts, goshipRates } from '@/lib/goship';
import { parcelFor } from '@/lib/parcel';
import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Which carriers will collect a parcel from this shop's door.
 *
 * GoShip quotes per route and says nothing in general, so coverage is probed:
 * the pickup address is quoted against the four big cities and against its own
 * district, and a carrier that answers on any of them collects here. SPX, for
 * instance, returns nothing at all out of Cà Mau — a seller there should learn
 * that when they set the shop up, not from the first order they cannot book.
 *
 * Stored on the profile with a timestamp; refreshed when the pickup address is
 * saved and again after a week, because carriers open depots.
 */

export type CarrierCoverage = {
    carriers: string[];
    checked_at: string;
    probes: { city: string; district: string; carriers: string[] }[];
};

export const COVERAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PROBE_CITIES = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Cần Thơ'];

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

async function probeDestinations(pickup: { city: string; district: string }) {
    const cities = await goshipCities();
    const targets: { city: string; district: string }[] = [{ city: pickup.city, district: pickup.district }];
    if (!cities.ok) return targets;
    // The four district lookups in parallel: serially they were four GoShip
    // round trips before a single rate was asked for, on a function with a
    // ten-second budget.
    const found = PROBE_CITIES
        .map((name) => cities.data.find((c) => fold(c.name).includes(fold(name))))
        .filter((c): c is { id: string; name: string } => !!c && String(c.id) !== pickup.city);
    const districts = await Promise.all(found.map((city) => goshipDistricts(String(city.id))));
    found.forEach((city, i) => {
        const list = districts[i];
        const district = list.ok ? list.data[0] : undefined;
        if (district) targets.push({ city: String(city.id), district: String(district.id) });
    });
    return targets;
}

export async function probeCarrierCoverage(pickup: { city: string; district: string }): Promise<
    { ok: true; coverage: CarrierCoverage; complete: boolean } | { ok: false; reason: string }
> {
    const offerable = new Set(OFFERABLE_COURIERS.map((c) => c.code as string));
    const targets = await probeDestinations(pickup);
    const answers = await Promise.all(targets.map(async (to) => {
        const result = await goshipRates({ from: pickup, to, parcel: parcelFor('card'), declaredValue: 0 });
        return { to, result };
    }));

    // Every probe failing is GoShip being down, not a shop nobody serves.
    if (answers.every((a) => !a.result.ok)) {
        return { ok: false, reason: answers[0]?.result.ok ? 'no_probe' : (answers[0]?.result as { reason: string }).reason };
    }
    // A partial answer is still worth showing, but not worth acting on: a
    // carrier missing from three probes because two timed out is not a carrier
    // that does not collect here. `complete` says whether the union may be
    // trusted to trim anything.
    const complete = answers.every((a) => a.result.ok);

    const probes = answers
        .filter((a) => a.result.ok)
        .map((a) => ({
            city: a.to.city,
            district: a.to.district,
            carriers: [...new Set((a.result as { ok: true; rates: { carrierCode: string }[] }).rates
                .map((r) => r.carrierCode)
                .filter((code) => offerable.has(code)))],
        }));
    const carriers = [...new Set(probes.flatMap((p) => p.carriers))]
        .sort((a, b) => OFFERABLE_COURIERS.findIndex((c) => c.code === a) - OFFERABLE_COURIERS.findIndex((c) => c.code === b));

    return { ok: true, coverage: { carriers, checked_at: new Date().toISOString(), probes }, complete };
}

export const coverageIsFresh = (coverage: CarrierCoverage | null | undefined): coverage is CarrierCoverage =>
    !!coverage && Array.isArray(coverage.carriers)
    && Date.now() - Date.parse(coverage.checked_at) < COVERAGE_TTL_MS;

/**
 * Probe, store, and trim the shop's carrier list to what actually collects.
 *
 * Returns the coverage or null when GoShip could not be asked; the caller
 * decides whether that is an error worth showing.
 */
export async function refreshCarrierCoverage(userId: string, pickup: { city: string; district: string }): Promise<CarrierCoverage | null> {
    const probed = await probeCarrierCoverage(pickup);
    if (!probed.ok) {
        console.error('[Coverage] probe failed:', probed.reason);
        return null;
    }
    const service = createServiceSupabaseClient();
    const { data } = await service.from('profiles').select('shipping_carriers, carrier_coverage').eq('id', userId).maybeSingle();
    const row = data as { shipping_carriers: string[] | null; carrier_coverage: CarrierCoverage | null } | null;
    const saved = row?.shipping_carriers ?? [];

    // Trim the seller's ticks only on a complete probe. On a partial one, keep
    // what they chose and keep the previous coverage if it was complete —
    // erasing a valid carrier over a GoShip timeout is worse than showing one
    // that may have gone.
    if (!probed.complete) {
        console.warn('[Coverage] partial probe; carriers not trimmed');
        if (row?.carrier_coverage?.carriers?.length) return row.carrier_coverage;
        const { error } = await service.from('profiles').update({ carrier_coverage: probed.coverage } as never).eq('id', userId);
        if (error) console.error('[Coverage] save failed:', error.message);
        return probed.coverage;
    }

    const kept = saved.filter((code) => probed.coverage.carriers.includes(code));
    const { error } = await service
        .from('profiles')
        .update({ carrier_coverage: probed.coverage, ...(kept.length !== saved.length ? { shipping_carriers: kept } : {}) } as never)
        .eq('id', userId);
    if (error) console.error('[Coverage] save failed:', error.message);
    return probed.coverage;
}
