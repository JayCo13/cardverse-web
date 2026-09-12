import { goshipCities, goshipDistricts, goshipWards } from '@/lib/goship';

/**
 * A place in the carrier's geography, and the names GoShip files it under.
 *
 * Server only — it calls GoShip. Both address stores now collect their
 * region here: `profiles.goship_pickup` (where a seller ships from) and
 * `shipping_addresses.goship` (where a buyer receives). The province/ward
 * columns beside each are copied from these names, never typed in and never
 * translated from the 2025 structure — Ho Chi Minh City now contains wards
 * GoShip still files under Bà Rịa - Vũng Tàu, so a name match books a courier
 * to the wrong city and reports success.
 */

export type GoshipRegion = { city: string; district: string; ward: string };

export type GoshipRegionNames = GoshipRegion & {
    cityName: string;
    districtName: string;
    wardName: string;
};

const ID = /^[0-9]{1,12}$/;

/** What to tell the user when a lookup fails, keyed by `resolveGoshipRegion`'s reason. */
export const GOSHIP_REGION_ERROR = {
    unavailable: 'Không tải được danh mục địa giới của đơn vị vận chuyển. Thử lại sau.',
    not_found: 'Phường/Xã không thuộc Quận/Huyện hoặc Tỉnh/Thành đã chọn.',
} as const;

/**
 * Null unless all three ids are there and well formed. Two of three is not an
 * address, and storing it would look bookable.
 */
export function parseGoshipRegion(input: unknown): GoshipRegion | null {
    if (!input || typeof input !== 'object') return null;
    const b = input as Record<string, unknown>;
    const city = String(b.city ?? '').trim();
    const district = String(b.district ?? '').trim();
    const ward = String(b.ward ?? '').trim();
    if (!ID.test(city) || !ID.test(district) || !ID.test(ward)) return null;
    return { city, district, ward };
}

/**
 * The names behind the ids, read from the same lists the user picked them
 * from. Districts are fetched under the city and wards under the district, so
 * a ward that is not in its district — or a district not in its city — comes
 * back as `not_found` rather than as a mismatched address.
 */
export async function resolveGoshipRegion(
    region: GoshipRegion,
): Promise<{ ok: true; value: GoshipRegionNames } | { ok: false; reason: 'unavailable' | 'not_found' }> {
    const [cities, districts, wards] = await Promise.all([
        goshipCities(),
        goshipDistricts(region.city),
        goshipWards(region.district),
    ]);
    if (!cities.ok || !districts.ok || !wards.ok) {
        console.error(
            '[GoshipRegion] lookup failed:',
            !cities.ok ? cities.reason : !districts.ok ? districts.reason : !wards.ok ? wards.reason : '',
        );
        return { ok: false, reason: 'unavailable' };
    }

    const city = cities.data.find((c) => String(c.id) === region.city);
    const district = districts.data.find((d) => String(d.id) === region.district);
    const ward = wards.data.find((w) => String(w.id) === region.ward);
    if (!city || !district || !ward) return { ok: false, reason: 'not_found' };

    return {
        ok: true,
        value: { ...region, cityName: city.name, districtName: district.name, wardName: ward.name },
    };
}
