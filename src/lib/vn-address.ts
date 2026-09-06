import provinces from '@/data/vn-provinces.json';
import wardsByProvince from '@/data/vn-wards.json';

/**
 * Vietnam's administrative divisions, read from the copy vendored in this repo.
 *
 * Two levels, not three. The district tier was abolished on 1/7/2025 and the 63
 * provinces became 34 (Nghị quyết 202/2025/QH15), so an address is now a
 * province and a ward. The old GHN feed this replaced still serves the
 * pre-reorganisation list of 65 provinces with districts beneath them, which is
 * a structure that no longer exists.
 *
 * Nothing here touches the network. `npm run data:address` refreshes the JSON,
 * and that is the only moment the outside world is involved — see
 * scripts/refresh-vn-address.mjs for why.
 */

export type VnProvince = { code: number; name: string; division_type: string };
export type VnWard = { code: number; name: string; division_type: string };

const PROVINCES = provinces as VnProvince[];
const WARDS = wardsByProvince as Record<string, VnWard[]>;

/** All 34 provinces, already sorted by Vietnamese collation. */
export const listProvinces = (): VnProvince[] => PROVINCES;

/** The wards of one province, or an empty list for a code that does not exist. */
export const listWards = (provinceCode: number): VnWard[] => WARDS[String(provinceCode)] ?? [];

export const findProvince = (code: number | null | undefined): VnProvince | null =>
    (code == null ? null : PROVINCES.find((p) => p.code === Number(code))) ?? null;

/**
 * A ward looked up within its province.
 *
 * Ward codes are unique nationwide in this dataset, but the province is asked
 * for anyway: an address whose ward does not belong to its province is wrong,
 * and this is the cheapest place to notice.
 */
export const findWard = (provinceCode: number | null | undefined, wardCode: number | string | null | undefined): VnWard | null => {
    if (provinceCode == null || wardCode == null) return null;
    return listWards(Number(provinceCode)).find((w) => w.code === Number(wardCode)) ?? null;
};

/** Is this province/ward pair a real place? Used to check what a browser sends. */
export const isValidAddress = (provinceCode: number | null | undefined, wardCode: number | string | null | undefined): boolean =>
    !!findProvince(provinceCode) && !!findWard(provinceCode, wardCode);
