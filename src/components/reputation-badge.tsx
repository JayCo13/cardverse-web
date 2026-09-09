'use client';

import { AlertTriangle, ShieldCheck, Star } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import {
    reputationTier,
    showsFigures,
    standingFromProfile,
    type ReputationStanding,
    type ReputationTier,
} from '@/lib/reputation';

/**
 * The single place that decides whether a person's standing is shown as a
 * number or as a word.
 *
 * Everywhere reputation appears calls this rather than formatting the columns
 * itself. The score is cumulative and starts at zero, so any site that forgets
 * the rule renders "0 điểm" on a brand-new account — which reads as a judgement
 * rather than an absence of history, and is exactly what eBay avoids by showing
 * no percentage at all until a seller has feedback.
 */

type Props = {
    /** A profile row in whatever column shape the calling query selected. */
    profile?: Record<string, unknown> | null;
    /** Or the already-derived standing, when the caller has one. */
    standing?: ReputationStanding;
    size?: 'sm' | 'md';
    className?: string;
    /**
     * Whether this surface may show the ⚠️ warning. Off by default, so a new
     * call site cannot brand somebody by accident — a buyer browsing listings
     * gets the counts and draws their own conclusion, the way eBay shows a
     * feedback figure and no "below standard" mark. Turn it on only where
     * somebody is about to act on it: the seller's own offer inbox, and a
     * person's own profile.
     */
    warnOnIncidents?: boolean;
};

const COPY = {
    'vi-VN': {
        orders: 'đơn hoàn tất',
        incidents: 'sự cố',
        trusted: 'Uy tín',
        highlyTrusted: 'Uy tín cao',
        flagged: 'Cần chú ý',
        unpaidCount: '{n} lần bỏ thanh toán',
    },
    'ja-JP': {
        orders: '件完了',
        incidents: '問題',
        trusted: '信頼できる',
        highlyTrusted: '高い信頼',
        flagged: '要注意',
        unpaidCount: '未払い{n}件',
    },
    'en-US': {
        orders: 'completed',
        incidents: 'incidents',
        trusted: 'Trusted',
        highlyTrusted: 'Highly trusted',
        flagged: 'Needs attention',
        unpaidCount: '{n} unpaid offers',
    },
} as const;

/**
 * Three registers, not five colours.
 *
 * The two neutral tiers carry the marketplace's own orange, kept far quieter
 * than the buttons do: a hairline border and a wash, never a fill. That is what
 * separates a chip that belongs to the brand from one that competes with Mua
 * ngay — same hue, a fraction of the weight.
 *
 * Emerald stays reserved for the two tiers somebody actually earned, and the
 * warning shifts from amber to rose so it cannot be mistaken for the orange
 * neutral at a glance.
 */
const TONE: Record<ReputationTier, string> = {
    flagged: 'border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    new: 'border-orange-500/30 bg-orange-500/[0.07] text-orange-700 dark:text-orange-300/90',
    plain: 'border-orange-500/30 bg-orange-500/[0.07] text-orange-700 dark:text-orange-300/90',
    trusted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    highly_trusted: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

export function ReputationBadge({ profile, standing: given, size = 'md', className = '', warnOnIncidents = false }: Props) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['en-US'];

    // No reputation data on the row means the caller did not fetch it, or the
    // ledger migration has not been applied. Render nothing rather than guess.
    const standing = given ?? standingFromProfile(profile);
    if (!standing) return null;

    const tier = reputationTier(standing, warnOnIncidents);

    const iconSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';
    const metrics = size === 'sm'
        ? 'text-[10px] gap-1 px-1.5 py-px'
        : 'text-[11px] gap-1.5 px-2 py-0.5';
    const shell = `inline-flex items-center rounded-full border font-medium leading-relaxed ${TONE[tier]} ${metrics} ${className}`;

    // Below the minimum sample, nothing renders at all.
    //
    // This started as a "Người mới" chip and the chip was the mistake. eBay
    // publishes no seller level below Top Rated, Airbnb's badges are Superhost
    // and Guest Favorite and nothing else, and Etsy will not even evaluate a
    // shop until ninety days after its first sale — none of the three labels a
    // newcomer. The absence of a badge is the signal, and it costs a card no
    // space to say it.
    //
    // It also stopped being information here. Every account on this marketplace
    // is under the threshold today, so the chip appeared on every listing and
    // told a buyer nothing they could act on.
    if (!showsFigures(tier)) return null;

    // The warning outranks a long clean record on purpose: two incidents inside
    // ninety days is the thing a counterparty needs to see, whatever the total.
    //
    // Where the caller knows the buyer-side count, the badge names it. "Needs
    // attention" is the same three words whether somebody left three accepted
    // offers unpaid or cancelled three of their own sales, and a seller about to
    // hand over a card for an hour is only exposed to the first.
    if (tier === 'flagged') {
        const label = standing.buyerIncidents90d === undefined
            ? copy.flagged
            : copy.unpaidCount.replace('{n}', String(standing.buyerIncidents90d));
        return (
            <span className={shell}>
                <AlertTriangle className={iconSize} aria-hidden />
                {label}
            </span>
        );
    }

    const label = tier === 'highly_trusted'
        ? copy.highlyTrusted
        : tier === 'trusted' ? copy.trusted : null;

    // Two counts, never the cumulative score. The score adds volume to quality
    // and subtracts one from the other, so it collides: 100 clean orders and 200
    // orders with five verified counterfeits both come to 100 points. A count of
    // orders and a count of incidents stay comparable between two accounts of
    // very different size, which is the whole job of this line.
    return (
        <span className={shell}>
            {tier === 'highly_trusted' ? <Star className={iconSize} aria-hidden />
                : tier === 'trusted' ? <ShieldCheck className={iconSize} aria-hidden />
                : null}
            {label ? <span>{label} ·</span> : null}
            <span>{standing.completedOrders} {copy.orders}</span>
            {standing.incidentsTotal > 0 ? (
                <span className="opacity-60">· {standing.incidentsTotal} {copy.incidents}</span>
            ) : null}
        </span>
    );
}

export default ReputationBadge;
