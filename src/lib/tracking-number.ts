/**
 * One shape for a tracking number, everywhere it is written or looked up.
 *
 * 17TRACK echoes numbers back in upper case regardless of how they were
 * registered, and the webhook feeds that echo straight into a lookup that
 * compares with `=`. A GHN number is mixed case — the ship dialog's own
 * placeholder reads `VD: LWtxxxxxxx` — so the number stored and the number
 * pushed back would never match, and the RPC answers a miss with `ok: true`:
 * no log, no retry, no one the wiser. Upper case on both sides removes the
 * mismatch instead of hiding it.
 *
 * A database trigger normalises writes as well, so a path that never reaches
 * this file still stores the same shape.
 */

/** Carriers print numbers with spaces for legibility; people paste them that way. */
export function normalizeTrackingNumber(raw: string | null | undefined): string {
    if (typeof raw !== 'string') return '';
    return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * Real carrier numbers are 8 characters or more — SPX runs to 17, GHN to about
 * 12 — while every junk value in the table today is shorter or is a repeated
 * letter: `11`, `ltw`, `daaaaa`, `lwcccc`. The floor is deliberately generous;
 * raise it only against a real carrier's format, never to catch more junk.
 *
 * The ceiling matches `apply_carrier_tracking_event`, which rejects anything
 * over 100. Writing above the ceiling the reader enforces is how a number gets
 * stored that can never be matched again.
 */
export const TRACKING_MIN_LENGTH = 8;
export const TRACKING_MAX_LENGTH = 40;

const TRACKING_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

export function isValidTrackingNumber(normalized: string): boolean {
    return normalized.length >= TRACKING_MIN_LENGTH
        && normalized.length <= TRACKING_MAX_LENGTH
        && TRACKING_PATTERN.test(normalized);
}
