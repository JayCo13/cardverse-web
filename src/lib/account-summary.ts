/**
 * Client-side access to `/api/account/summary`, shared by every consumer.
 *
 * Two things went wrong without it. The header fired its badge request twice on
 * load — the effect reruns when auth resolves from `null` to a user, and the
 * first request was already in flight — and on the seller dashboard the header
 * and the page each asked for the same offer counts independently.
 *
 * So callers go through here instead of `fetch`. A request already in flight is
 * shared rather than duplicated, and a result is reused for a few seconds,
 * which is the window in which those duplicates happen. It is not a cache in
 * any meaningful sense: anything that changes a count invalidates it, and the
 * consumers below already listen for exactly those events.
 */

export type AccountSummary = {
    cartCount: number;
    receivedPending: number;
    sentAwaitingPayment: number;
    actionCount: number;
    cardPendingCounts: Record<string, number>;
};

const EMPTY: AccountSummary = {
    cartCount: 0,
    receivedPending: 0,
    sentAwaitingPayment: 0,
    actionCount: 0,
    cardPendingCounts: {},
};

/** Long enough to fold a mount's duplicate calls together, short enough that a
 *  count never looks stale to someone watching it. */
const FRESH_FOR_MS = 5_000;

let inFlight: Promise<AccountSummary> | null = null;
let cached: { at: number; value: AccountSummary } | null = null;

function readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function request(): Promise<AccountSummary> {
    const response = await fetch('/api/account/summary', { cache: 'no-store' });
    if (!response.ok) return EMPTY;
    const payload = await response.json();
    return {
        cartCount: readNumber(payload.cartCount),
        receivedPending: readNumber(payload.receivedPending),
        sentAwaitingPayment: readNumber(payload.sentAwaitingPayment),
        actionCount: readNumber(payload.actionCount),
        cardPendingCounts: (payload.cardPendingCounts || {}) as Record<string, number>,
    };
}

export async function getAccountSummary(options?: { force?: boolean }): Promise<AccountSummary> {
    if (!options?.force) {
        if (cached && Date.now() - cached.at < FRESH_FOR_MS) return cached.value;
        if (inFlight) return inFlight;
    }

    const pending = request()
        .then(value => {
            cached = { at: Date.now(), value };
            return value;
        })
        .catch(() => EMPTY)
        .finally(() => {
            if (inFlight === pending) inFlight = null;
        });

    inFlight = pending;
    return pending;
}

/** Drop the shared result so the next read goes to the server. Call after
 *  anything that moves a cart or offer count. */
export function invalidateAccountSummary() {
    cached = null;
}

/** Signed out: nothing to show, and nothing worth keeping from the last user. */
export function resetAccountSummary() {
    cached = null;
    inFlight = null;
}

export const EMPTY_ACCOUNT_SUMMARY = EMPTY;
