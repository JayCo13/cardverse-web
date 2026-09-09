'use client';

import { useLocalization } from '@/context/localization-context';
import { isNewAccount, standingFromProfile, type ReputationStanding } from '@/lib/reputation';

/**
 * A ring around a seller's avatar, with a small NEW tag on its lower edge, for
 * an account that has not yet completed enough orders to show any figures.
 *
 * The pattern is the one Instagram and TikTok use for LIVE: a coloured ring
 * reads as "there is something about this person" and the tag on the edge says
 * what, without either taking a line of layout. That is the whole reason to
 * decorate the avatar instead of adding a chip under the name — the seller row
 * on a listing card is one line tall and every chip put in it pushed the price
 * around.
 *
 * Worth knowing what this departs from: eBay, Airbnb and Etsy all publish
 * nothing at all for a new seller — Etsy will not even evaluate a shop until
 * ninety days after its first sale. The absence of a badge is their signal.
 * This marks newcomers on purpose instead, which on a marketplace where every
 * account is new means the ring is currently on every listing. Once accounts
 * start crossing five completed orders it thins out on its own.
 *
 * Renders its children untouched for every other tier, so nothing pays for the
 * wrapper except the accounts it is about.
 */

type Props = {
    /** A profile row in whatever column shape the caller's query selected. */
    profile?: Record<string, unknown> | null;
    /** Or the already-derived standing, when the caller has one. */
    standing?: ReputationStanding | null;
    /**
     * Hide the tag below the `md` breakpoint, keeping the ring. Set this where
     * the avatar shrinks on phones — a 22px circle has no room for a word, and
     * the ring alone still reads.
     */
    compact?: boolean;
    /**
     * Skip the ring and place only the tag. For an avatar that already draws a
     * ring of its own — the profile header does — two concentric rings read as
     * a rendering fault, so that surface recolours the ring it has and takes
     * just the tag from here.
     */
    withRing?: boolean;
    children: React.ReactNode;
};

const COPY = {
    'vi-VN': { tag: 'NEW', full: 'Người bán mới' },
    'ja-JP': { tag: 'NEW', full: '新規販売者' },
    'en-US': { tag: 'NEW', full: 'New seller' },
} as const;

export function NewSellerFrame({ profile, standing: given, compact = false, withRing = true, children }: Props) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['en-US'];

    // A row with no reputation columns reads as "not fetched", never as "new" —
    // the same rule `standingFromProfile` exists to enforce everywhere else.
    const standing = given ?? standingFromProfile(profile);
    if (!isNewAccount(standing)) return <>{children}</>;

    // Two wrappers on purpose, and the reason is a bug worth not repeating.
    //
    // The outer one is the flex/grid item. Grid defaults to `align-items:
    // stretch`, so on the offer inbox — a `grid-cols-[auto_minmax(0,1fr)]` row
    // as tall as the price and the badges beside it — a single wrapper was
    // stretched to the full row height. The ring stretched with it into an
    // ellipse, and the tag, positioned against that same box, dropped to the
    // bottom of the row instead of sitting under the avatar.
    //
    // `items-start` stops the inner box inheriting that stretch, and the inner
    // box — sized to the avatar — is what the ring draws on and what the tag is
    // positioned against. The outer box may stretch all it likes; nothing is
    // painted on it.
    return (
        <span className="inline-flex shrink-0 items-start">
            <span className={`relative inline-flex ${withRing
                ? 'rounded-full ring-2 ring-orange-500/70 ring-offset-2 ring-offset-background'
                : ''}`}>
                {children}
                {/* Typography at this size is its own problem. 9px bold with wide
                    tracking closed the counters up and the word read as a smudge;
                    10px semibold with a measured 0.06em opens the letterforms back
                    out without making the tag louder. `leading-none` plus explicit
                    vertical padding centres the caps optically — caps have no
                    descenders, so line-height centring sits them low. */}
                <span
                    aria-hidden
                    className={`pointer-events-none absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full
                        border border-background bg-orange-500 px-[7px] pb-[3px] pt-[4px] text-[10px]
                        font-semibold uppercase leading-none tracking-[0.06em] text-white
                        ${compact ? 'hidden md:block' : ''}`}
                >
                    {copy.tag}
                </span>
                {/* The ring and the tag are decoration; this is the part a screen
                    reader gets. */}
                <span className="sr-only">{copy.full}</span>
            </span>
        </span>
    );
}

export default NewSellerFrame;
