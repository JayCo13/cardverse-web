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

let inFlight: Promise<AccountSummary | null> | null = null;
let cached: { at: number; value: AccountSummary } | null = null;

let accountId: string | null = null;
let generation = 0;

function readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function request(): Promise<AccountSummary> {
    const response = await fetch('/api/account/summary', { cache: 'no-store' });
    if (!response.ok) throw new Error('Account summary unavailable');
    const payload = await response.json();
    return {
        cartCount: readNumber(payload.cartCount),
        receivedPending: readNumber(payload.receivedPending),
        sentAwaitingPayment: readNumber(payload.sentAwaitingPayment),
        actionCount: readNumber(payload.actionCount),
        cardPendingCounts: (payload.cardPendingCounts || {}) as Record<string, number>,
    };
}

export async function getAccountSummary(userId: string, options?: { force?: boolean }): Promise<AccountSummary | null> {
    if (accountId !== userId) {
        resetAccountSummary();
        accountId = userId;
    }
    if (options?.force) invalidateAccountSummary();
    if (cached && Date.now() - cached.at < FRESH_FOR_MS) return cached.value;
    if (inFlight) return inFlight;

    const version = generation;
    const pending = request()
        .then(value => {
            if (version !== generation || accountId !== userId) return null;
            cached = { at: Date.now(), value };
            return value;
        })
        .catch(() => null)
        .finally(() => {
            if (inFlight === pending) inFlight = null;
        });
    inFlight = pending;
    return pending;
}

/** Invalidate both completed and outstanding reads after a mutation. */
export function invalidateAccountSummary() {
    generation++;
    cached = null;
    inFlight = null;
}

export function resetAccountSummary() {
    invalidateAccountSummary();
    accountId = null;
}

export const EMPTY_ACCOUNT_SUMMARY = EMPTY;
