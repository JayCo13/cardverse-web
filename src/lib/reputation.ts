/**
 * Every number the reputation system shows or enforces, in one place.
 *
 * The display rules matter as much as the arithmetic. A cumulative score is the
 * only shape that keeps a hundred clean orders ahead of one, but it starts at
 * zero, and "0 điểm" on a new seller's card reads as a verdict rather than an
 * absence of history. eBay hides the percentage entirely until a seller has
 * feedback; Shopee gives new shops no badge at all and makes "Shop Yêu Thích"
 * something earned at 100+ delivered orders. Both are saying the same thing:
 * below a minimum sample, show a word, not a number.
 *
 * The ⚠️ badge deliberately reads an incident count rather than the score.
 * Reading the score would let a seller with two hundred completed orders bank
 * enough points to absorb a dozen no-shows without crossing a threshold, while a
 * new buyer goes negative on their first mistake. A count in a rolling window is
 * also self-clearing: nothing has to run to lift it.
 *
 * Everything here is display, and after 20260909000600 display is very nearly
 * the whole enforcement story: an unpaid offer costs 5 points and earns the ⚠️
 * badge, and that is all that happens automatically. eBay's platform layer
 * publishes no threshold and no duration either; the only thing that blocks
 * anybody there is a per-seller setting, which is what `offer_block_incidents`
 * now is here.
 *
 * That seller gate counts unpaid offers and verified fraud alone, while
 * `incidents90d` below counts every negative event including the ones a seller
 * earned while selling. The two numbers are different on purpose. Deciding a
 * gate from the badge's number is what hid the offer form from sellers whose
 * only marks were cancelled sales, so nothing in this file may stand in for
 * `offer_gate_for_card` — the modal asks the database.
 */

/** Attempts one buyer may make on one card, counting rejected and expired ones. */
export const MAX_OFFERS_PER_CARD = 5;

/** Incidents inside the window that earn the ⚠️ badge. Not an offer gate. */
export const FLAGGED_INCIDENTS = 2;

/**
 * Range a seller may set `offer_block_incidents` to, matching eBay's Buyer
 * Requirements. Null — off — is the default and stays the common case.
 */
export const SELLER_BLOCK_MIN_INCIDENTS = 2;
export const SELLER_BLOCK_MAX_INCIDENTS = 5;

/** Rolling window for every gate and for the ⚠️ badge. */
export const INCIDENT_WINDOW_DAYS = 90;

/** Below this many completed orders, no number is shown at all. */
export const MIN_ORDERS_TO_SHOW_SCORE = 5;

export const TRUSTED_MIN_ORDERS = 30;
export const HIGHLY_TRUSTED_MIN_ORDERS = 100;

/**
 * Lifetime share of orders that may carry an incident and still earn ⭐.
 * A rate, not a zero: at a hundred orders one bad month should not cost the
 * label a seller spent two years earning, and 1 in 150 is not the same fact as
 * 1 in 6. The ⚠️ badge above still outranks it either way.
 */
export const HIGHLY_TRUSTED_MAX_INCIDENT_RATE = 0.02;

/** Minutes a card is held for the buyer whose offer was accepted. */
export const OFFER_PAYMENT_WINDOW_MINUTES = 60;

export type ReputationTier = 'flagged' | 'new' | 'plain' | 'trusted' | 'highly_trusted';

export type ReputationStanding = {
    score: number;
    completedOrders: number;
    incidents90d: number;
    incidentsTotal: number;
    /**
     * Incidents this person caused as a buyer — unpaid accepted offers and
     * verified fraud — inside the same window. Present only where the caller
     * asked for it, which today means a seller's offer inbox.
     *
     * When it is present it decides the ⚠️ badge in place of `incidents90d`,
     * because the question there is "will this person pay", and a seller whose
     * only marks are sales they cancelled answers it with a clean record. When
     * it is absent nothing changes: the badge falls back to the whole-account
     * count, which is the right summary on a profile or a listing.
     */
    buyerIncidents90d?: number;
};

export const emptyStanding = (): ReputationStanding => ({
    score: 0,
    completedOrders: 0,
    incidents90d: 0,
    incidentsTotal: 0,
});

/**
 * Returns null when the row carries no reputation data at all — a query that did
 * not select the columns, or a database where the ledger migration has not run
 * yet. That case must not fall through to zeros: zeros render as "New user", so
 * a seller with two hundred completed orders would be labelled a newcomer purely
 * because of how the row was fetched. Absent and new are different things and
 * only the caller can tell them apart.
 */
export const standingFromProfile = (
    profile: Record<string, unknown> | null | undefined,
): ReputationStanding | null => {
    if (!profile || profile.reputation_score === undefined || profile.reputation_score === null) {
        return null;
    }
    return {
        score: Number(profile.reputation_score),
        completedOrders: Number(profile.completed_transactions ?? 0),
        incidents90d: Number(profile.reputation_incidents_90d ?? 0),
        incidentsTotal: Number(profile.reputation_incidents_total ?? 0),
        // Not a column: `GET /api/offers/inbox` folds the buyer_incident_counts
        // RPC into the row before handing it over.
        buyerIncidents90d: profile.buyer_incidents_90d == null
            ? undefined
            : Number(profile.buyer_incidents_90d),
    };
};

/**
 * Order matters: the warning outranks everything, including a long clean record,
 * and "new" outranks the tiers so a fresh account is never shown a bare number.
 *
 * `allowFlagged` is how a surface says whether it is allowed to brand somebody,
 * and it is off unless asked for. eBay publishes only the positive tier — "other
 * eBay members can't see your seller level, unless you are Top Rated" — and keeps
 * Below Standard between the seller and their own dashboard, punishing it through
 * fees and search ranking instead. The default follows that, so a surface added
 * later cannot mark somebody by forgetting an argument. Two callers opt in: the
 * seller's offer inbox and a person's own profile.
 *
 * With it off the account falls to whatever tier it would have held without the
 * incidents, and the incident count still shows as a plain number, so a buyer can
 * still tell two sellers apart.
 */
export const reputationTier = (
    standing: ReputationStanding,
    allowFlagged = false,
): ReputationTier => {
    // Where the caller knows what this person does as a buyer, that is what the
    // warning is about; otherwise the whole account.
    const flagging = standing.buyerIncidents90d ?? standing.incidents90d;
    if (allowFlagged && flagging >= FLAGGED_INCIDENTS) return 'flagged';
    if (standing.completedOrders < MIN_ORDERS_TO_SHOW_SCORE) return 'new';
    if (standing.completedOrders >= HIGHLY_TRUSTED_MIN_ORDERS
        && standing.incidentsTotal / standing.completedOrders <= HIGHLY_TRUSTED_MAX_INCIDENT_RATE) {
        return 'highly_trusted';
    }
    if (standing.completedOrders >= TRUSTED_MIN_ORDERS && standing.incidents90d === 0) {
        return 'trusted';
    }
    return 'plain';
};

/**
 * Whether an account is still below the minimum sample. Always read with the
 * flag off: "new" is a public fact, and a surface that let `flagged` win here
 * would silently skip the treatment for exactly the accounts carrying
 * incidents — the newcomer ring stopped appearing on its first outing for
 * precisely that reason.
 */
export const isNewAccount = (standing: ReputationStanding | null | undefined): boolean =>
    !!standing && reputationTier(standing, false) === 'new';

/** The one question every display site asks before rendering any figure. */
export const showsFigures = (tier: ReputationTier): boolean => tier !== 'new';
