/**
 * Display names that impersonate the platform.
 *
 * "CardVerseHub - Seller" is the one official storefront account. Nobody else
 * may call themselves CardVerse / CardVerseHub in any spelling — "Card Verse",
 * "card-verse-hub", "CARDVERSE99" all collapse to the same thing once
 * lowercased and stripped of separators. The database enforces this with the
 * same rule (see the reserve_cardverse_display_name migration); this copy only
 * exists so forms can refuse before the round trip.
 */
const RESERVED_STEMS = ['cardverse'];

export function normalizeDisplayName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isReservedDisplayName(name: string | null | undefined): boolean {
    if (!name) return false;
    const normalized = normalizeDisplayName(name);
    return RESERVED_STEMS.some((stem) => normalized.includes(stem));
}
