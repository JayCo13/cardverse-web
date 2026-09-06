"use client";

import { Card as CardUI, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
    User, ShoppingBag, Tag, Shield, Package, Clock, CheckCircle, XCircle,
    ChevronRight, BadgeCheck, CalendarDays, Wallet, ShieldCheck,
    Medal, Award, Trophy, Crown, Gem,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLocalization } from "@/context/localization-context";
import { formatCompactCount } from "@/lib/format";

/**
 * The profile, rendered once for two audiences.
 *
 * `/profile` (the account owner) and `/users/[id]` (anyone else) used to be one
 * page and no page respectively; splitting them into two components would have
 * let the two drift, which is the thing this page was redesigned to stop. So
 * the layout lives here and `mode` decides what is withheld.
 *
 * What a visitor is not shown — email, revenue, spend, purchase history — is
 * modelled on eBay's public feedback profile, which publishes reputation and a
 * registration date and no money at all. It is also what the database will
 * allow: `transactions` and `orders` are locked to their parties by RLS
 * (20260901000100_rls_orders_transactions_owner_only.sql), so a visitor's
 * browser could not total someone else's takings even if this page asked.
 */

/**
 * Money on this page is never converted.
 *
 * Marketplace listings and transactions are entered and stored in VND — see
 * `priceIsVnd` on the buy and card-detail pages. `useCurrency().formatPrice`
 * takes a USD amount and multiplies by the exchange rate, so passing a stored
 * price through it rendered a 300.000 ₫ card as 7.635.000.000 ₫. Format the
 * stored number directly, exactly as `/cards/[id]` does.
 */
export const formatVnd = (amount: number | null | undefined) =>
    amount === null || amount === undefined
        ? "-"
        : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

/**
 * Rank thresholds, measured in completed sales.
 *
 * Each rank is struck from the metal it is named after, using the standard hex
 * for that metal at the midpoint of the gradient — bronze #cd7f32, silver
 * #c0c0c0, gold #ffd700, platinum #e5e4e2 — with a lighter highlight above and
 * a shadow below, which is what makes a flat disc read as a struck face. A
 * translucent tint over a dark page carries almost no contrast and reads as a
 * smudge instead of an award.
 *
 * The icons climb rather than repeat: medal, rosette, trophy, crown, gem. Two
 * ranks previously shared the same shield, so the badge could not tell Bronze
 * from Silver at a glance — the one job it has.
 *
 * Silver and platinum are both pale, so platinum carries a cool cast and a
 * whiter highlight to keep them apart at badge size.
 *
 * These class strings must stay in a file under src/components: Tailwind only
 * scans src/{app,components,pages}, so a palette moved to src/lib stops being
 * generated. See the category-badge note in CLAUDE.md.
 */
export const RANKS = [
    {
        name: "Bronze", minSales: 0, icon: Medal,
        medal: "bg-[linear-gradient(135deg,#f5c396_0%,#cd7f32_48%,#7c4a1e_100%)]",
        glow: "shadow-[0_0_16px_-2px_rgba(205,127,50,0.65)]",
        ring: "ring-[#cd7f32]/60",
        text: "text-[#d98b4a]",
    },
    {
        name: "Silver", minSales: 5, icon: Award,
        medal: "bg-[linear-gradient(135deg,#fdfdfd_0%,#c0c0c0_48%,#6b7280_100%)]",
        glow: "shadow-[0_0_16px_-2px_rgba(192,192,192,0.6)]",
        ring: "ring-[#c0c0c0]/60",
        text: "text-zinc-200",
    },
    {
        name: "Gold", minSales: 20, icon: Trophy,
        medal: "bg-[linear-gradient(135deg,#fff3b0_0%,#ffd700_48%,#a67c00_100%)]",
        glow: "shadow-[0_0_18px_-2px_rgba(255,215,0,0.65)]",
        ring: "ring-[#ffd700]/60",
        text: "text-[#ffd700]",
    },
    {
        name: "Platinum", minSales: 50, icon: Crown,
        medal: "bg-[linear-gradient(135deg,#ffffff_0%,#e5e4e2_45%,#8ea3ad_100%)]",
        glow: "shadow-[0_0_18px_-2px_rgba(196,214,224,0.7)]",
        ring: "ring-[#c4d6e0]/70",
        text: "text-[#dfeaf1]",
    },
    {
        name: "Diamond", minSales: 100, icon: Gem,
        medal: "bg-[linear-gradient(135deg,#e0f7ff_0%,#67e8f9_45%,#0e7490_100%)]",
        glow: "shadow-[0_0_20px_-2px_rgba(103,232,249,0.7)]",
        ring: "ring-[#67e8f9]/60",
        text: "text-cyan-300",
    },
] as const;

/**
 * Account ranks are hidden for now.
 *
 * Bronze/Silver/Gold/Platinum/Diamond grant nothing yet, so the only thing the
 * badge and the progress bar did was raise a question with no answer — and a
 * worse one than that: ranks count COMPLETED orders (`update_seller_reputation`
 * fires on the confirm branch of /api/marketplace/orders), while the "Sold" tab
 * lists cards whose status flipped to 'sold' the moment the buyer paid. A
 * seller with four paid-but-undelivered orders therefore read "4 sold" above
 * "5 more sales to reach Silver".
 *
 * Everything below is kept and still computed; flip this to true once a rank
 * actually earns the holder something, and fix the wording at the same time.
 */
const SHOW_ACCOUNT_RANK: boolean = false;

export type ProfileListingCard = {
    id: string;
    name: string;
    imageUrl: string;
    listingType: string | null;
    price: number | null;
    lastSoldPrice: number | null;
    status: string | null;
};

export type ProfileTxRow = {
    id: string;
    cardId: string | null;
    cardName: string | null;
    cardImage: string | null;
    price: number | null;
    status: string | null;
    createdAt: string;
    completedAt: string | null;
    direction: "buy" | "sell";
};

/**
 * The public half of a profile. Every field here is readable by anyone, so a
 * visitor page can fill it from the browser without a privileged route.
 *
 * `sellerRating` is a PERCENTAGE of orders that went well, and
 * `sellerReviewCount` is the count of orders that went well — both maintained
 * by `update_seller_reputation()`. Neither is a star rating, and this page
 * spent a while claiming otherwise ("⭐ 0.0 · 0 đánh giá"). The wording below
 * matches `card-item.tsx` so the same seller reads the same on every surface.
 */
export type ProfileIdentity = {
    displayName: string | null;
    /** Owner view only. A visitor is never handed this. */
    email: string | null;
    profileImageUrl: string | null;
    sellerVerified: boolean;
    sellerRating: number;
    sellerReviewCount: number;
    legitRate: number;
    totalTransactions: number;
    completedTransactions: number;
    createdAt: string | null;
};

/** The private half, supplied only when the viewer owns the profile. */
export type ProfileOwnerExtras = {
    grossRevenue: number;
    totalSpent: number;
    boughtCount: number;
    purchases: ProfileTxRow[];
    transactions: ProfileTxRow[];
    /** True when a lifetime total was computed from a capped row set. */
    truncated: boolean;
    /** The cap that produced `truncated`, for the note under the rank bar. */
    rowCap: number;
};

export function ProfileView({
    mode,
    identity,
    activeCards,
    soldCards,
    owner,
    action,
}: {
    mode: "owner" | "visitor";
    identity: ProfileIdentity;
    activeCards: ProfileListingCard[];
    soldCards: ProfileListingCard[];
    /** Required when `mode` is "owner"; ignored otherwise. */
    owner?: ProfileOwnerExtras;
    /** The header button: "Edit profile" for the owner, "Message" for a visitor. */
    action?: React.ReactNode;
}) {
    const { locale } = useLocalization();
    const isOwner = mode === "owner";

    const copy = locale === "vi-VN"
        ? {
            verifiedSeller: "Người bán đã xác minh",
            memberSince: "Thành viên từ {date}",
            positive: "uy tín",
            itemsSold: "đã bán",
            newSeller: "Người bán mới",
            revenue: "Doanh thu",
            revenueHint: "Từ {count} đơn đã hoàn tất",
            spent: "Đã chi",
            spentHint: "Qua {count} đơn đã mua",
            listings: "Đang bán",
            listingsHint: "{count} thẻ đã bán xong",
            soldStat: "Đã bán",
            soldStatHint: "Đơn hàng thành công",
            legitScore: "Điểm uy tín",
            legitHint: "{completed}/{total} giao dịch hoàn tất",
            accountRank: "Hạng tài khoản",
            toRankUp: "Còn {count} đơn nữa để lên {rank}",
            highestRank: "Đã đạt hạng cao nhất",
            approxNote: "Chỉ tính {cap} giao dịch gần nhất",
            sellingTab: "Đang bán",
            soldTab: "Đã bán",
            boughtTab: "Đã mua",
            transactionsTab: "Giao dịch",
            inTransaction: "Đang giao dịch",
            auction: "Đấu giá",
            razz: "Razz",
            buyNow: "Mua ngay",
            noSelling: "Bạn chưa đăng bán thẻ nào",
            listNow: "Đăng bán ngay",
            noBought: "Bạn chưa mua thẻ nào",
            exploreNow: "Khám phá ngay",
            noSold: "Bạn chưa bán thẻ nào",
            noSellingOther: "Người này chưa đăng bán thẻ nào",
            noSoldOther: "Người này chưa bán được thẻ nào",
            sellType: "Bán",
            buyType: "Mua",
            completed: "Hoàn tất",
            cancelled: "Đã hủy",
            expired: "Hết hạn",
            processing: "Đang xử lý",
            details: "Chi tiết",
            noTransactions: "Chưa có giao dịch nào",
            unknownCard: "Thẻ không còn tồn tại",
        }
        : locale === "ja-JP"
            ? {
                verifiedSeller: "認証済み出品者",
                memberSince: "{date} から利用",
                positive: "高評価",
                itemsSold: "販売",
                newSeller: "新規販売者",
                revenue: "売上",
                revenueHint: "完了した{count}件から",
                spent: "支出",
                spentHint: "購入{count}件",
                listings: "出品中",
                listingsHint: "販売済み{count}枚",
                soldStat: "販売済み",
                soldStatHint: "成立した取引",
                legitScore: "信頼スコア",
                legitHint: "取引完了 {completed}/{total}",
                accountRank: "アカウントランク",
                toRankUp: "{rank}まであと{count}件",
                highestRank: "最高ランクです",
                approxNote: "直近{cap}件のみ集計",
                sellingTab: "出品中",
                soldTab: "販売済み",
                boughtTab: "購入済み",
                transactionsTab: "取引",
                inTransaction: "取引中",
                auction: "オークション",
                razz: "Razz",
                buyNow: "今すぐ購入",
                noSelling: "まだカードを出品していません",
                listNow: "今すぐ出品",
                noBought: "まだカードを購入していません",
                exploreNow: "探す",
                noSold: "まだカードを販売していません",
                noSellingOther: "このユーザーはまだ出品していません",
                noSoldOther: "このユーザーはまだ販売実績がありません",
                sellType: "販売",
                buyType: "購入",
                completed: "完了",
                cancelled: "キャンセル済み",
                expired: "期限切れ",
                processing: "処理中",
                details: "詳細",
                noTransactions: "まだ取引はありません",
                unknownCard: "カードは削除されました",
            }
            : {
                verifiedSeller: "Verified seller",
                memberSince: "Member since {date}",
                positive: "positive",
                itemsSold: "sold",
                newSeller: "New seller",
                revenue: "Revenue",
                revenueHint: "From {count} completed orders",
                spent: "Spent",
                spentHint: "Across {count} purchases",
                listings: "Listed",
                listingsHint: "{count} cards sold",
                soldStat: "Sold",
                soldStatHint: "Completed orders",
                legitScore: "Trust score",
                legitHint: "{completed}/{total} transactions completed",
                accountRank: "Account rank",
                toRankUp: "{count} more sales to reach {rank}",
                highestRank: "Highest rank reached",
                approxNote: "Counts the {cap} most recent transactions",
                sellingTab: "Selling",
                soldTab: "Sold",
                boughtTab: "Bought",
                transactionsTab: "Transactions",
                inTransaction: "In transaction",
                auction: "Auction",
                razz: "Razz",
                buyNow: "Buy now",
                noSelling: "You have not listed any cards yet",
                listNow: "List now",
                noBought: "You have not bought any cards yet",
                exploreNow: "Explore now",
                noSold: "You have not sold any cards yet",
                noSellingOther: "This member has no cards listed",
                noSoldOther: "This member has not sold any cards yet",
                sellType: "Sell",
                buyType: "Buy",
                completed: "Completed",
                cancelled: "Cancelled",
                expired: "Expired",
                processing: "Processing",
                details: "Details",
                noTransactions: "No transactions yet",
                unknownCard: "Card no longer exists",
            };

    const fill = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce(
            (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
            template,
        );

    const legitColor = (rate: number) =>
        rate >= 90 ? "text-green-500"
            : rate >= 70 ? "text-yellow-500"
                : rate >= 50 ? "text-orange-500"
                    : "text-red-500";

    /**
     * Sales count comes from `profiles.seller_review_count`, not from counting
     * transaction rows. It is the number `/cards/[id]` and `card-item.tsx`
     * already print, and it is readable by a visitor, so the owner view and the
     * public view cannot disagree about how many cards someone has sold.
     */
    const soldCount = identity.sellerReviewCount;
    const rank = [...RANKS].reverse().find((r) => soldCount >= r.minSales) ?? RANKS[0];
    const RankIcon = rank.icon;
    const rankIndex = RANKS.findIndex((r) => r.name === rank.name);
    const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;
    const rankProgress = nextRank
        ? Math.min(100, ((soldCount - rank.minSales) / (nextRank.minSales - rank.minSales)) * 100)
        : 100;

    /**
     * The reputation line, word for word from `card-item.tsx`'s
     * `sellerStatsText`. A seller who reads "95.0% uy tín · 12 đã bán" under a
     * listing must read the same thing on their profile.
     */
    const reputationText = identity.sellerRating > 0
        ? `${identity.sellerRating.toFixed(1)}% ${copy.positive}`
        : copy.newSeller;

    const joinedAt = identity.createdAt
        ? new Date(identity.createdAt).toLocaleDateString(locale, { month: "long", year: "numeric" })
        : null;

    /**
     * Listing type as a coloured chip. All three rendered as the same grey
     * outline before, so the one thing that changes how a card is bought was
     * the least visible label on the tile.
     */
    const listingTypeChip = (type: string | null) =>
        type === "auction"
            ? { label: copy.auction, className: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30" }
            : type === "razz"
                ? { label: copy.razz, className: "bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/30" }
                : { label: copy.buyNow, className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30" };

    const statusLabel = (status: string | null) =>
        status === "completed" ? copy.completed
            : status === "cancelled" ? copy.cancelled
                : status === "auto_cancelled" ? copy.expired
                    : copy.processing;

    return (
        <main className="container mx-auto px-4 py-8">
            {/* ── Identity ───────────────────────────────────────────── */}
            <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 md:p-8 mb-6">
                <div className="flex flex-col sm:flex-row items-start gap-6">
                    <div className="relative shrink-0">
                        <div className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden bg-muted ring-4 ring-offset-2 ring-offset-background ${SHOW_ACCOUNT_RANK ? rank.ring : "ring-border"}`}>
                            {identity.profileImageUrl ? (
                                <Image
                                    src={identity.profileImageUrl}
                                    alt={identity.displayName || ""}
                                    fill
                                    sizes="112px"
                                    className="object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <User className="h-10 w-10 text-muted-foreground" />
                                </div>
                            )}
                        </div>
                        {/* Struck as a medal: the dark icon reads against lit
                            metal, where a coloured icon on a tinted disc did
                            not read at all. */}
                        {SHOW_ACCOUNT_RANK && (
                            <div
                                className={`absolute -bottom-1 -right-1 grid place-items-center h-9 w-9 rounded-full
                                    ${rank.medal} ${rank.glow} ring-[3px] ring-background`}
                                title={rank.name}
                            >
                                <RankIcon className="h-[18px] w-[18px] text-black/75" strokeWidth={2.5} />
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h1 className="text-2xl md:text-3xl font-bold truncate">
                                {identity.displayName || copy.newSeller}
                            </h1>
                            {identity.sellerVerified && (
                                <Badge className="gap-1 border-0 pl-1.5 pr-2.5 text-black font-semibold
                                    bg-[linear-gradient(135deg,#7dd3fc_0%,#0ea5e9_50%,#0369a1_100%)]
                                    shadow-[0_0_14px_-2px_rgba(14,165,233,0.6)]">
                                    <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                                    {copy.verifiedSeller}
                                </Badge>
                            )}
                            {SHOW_ACCOUNT_RANK && (
                                <Badge className={`gap-1 border-0 pl-1.5 pr-2.5 text-black font-semibold uppercase tracking-wide
                                    ${rank.medal} ${rank.glow}`}>
                                    <RankIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
                                    {rank.name}
                                </Badge>
                            )}
                        </div>

                        {/* The owner's own address, and nobody else's. */}
                        {isOwner && identity.email && (
                            <p className="text-sm text-muted-foreground mb-3 truncate">{identity.email}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                            <span className="flex items-center gap-1.5">
                                <ShieldCheck className={`h-4 w-4 ${identity.sellerRating > 0 ? "text-green-500" : "text-muted-foreground"}`} />
                                <span className="font-semibold">{reputationText}</span>
                                <span className="text-muted-foreground">
                                    · {formatCompactCount(soldCount, locale)} {copy.itemsSold}
                                </span>
                            </span>
                            {joinedAt && (
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <CalendarDays className="h-4 w-4" />
                                    {fill(copy.memberSince, { date: joinedAt })}
                                </span>
                            )}
                        </div>
                    </div>

                    {action}
                </div>
            </section>

            {/* ── Numbers ────────────────────────────────────────────── */}
            {/* A visitor gets reputation only. eBay publishes a seller's
                feedback and registration date and never their takings; the
                RLS on `transactions` says the same thing in SQL. */}
            <section className={`grid gap-4 mb-6 ${isOwner ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}>
                {isOwner && owner && (
                    <>
                        <StatTile
                            icon={<Wallet className="h-4 w-4" />}
                            label={copy.revenue}
                            value={formatVnd(owner.grossRevenue)}
                            hint={fill(copy.revenueHint, { count: soldCount })}
                            accent="text-green-500"
                        />
                        <StatTile
                            icon={<ShoppingBag className="h-4 w-4" />}
                            label={copy.spent}
                            value={formatVnd(owner.totalSpent)}
                            hint={fill(copy.spentHint, { count: owner.boughtCount })}
                        />
                    </>
                )}
                <StatTile
                    icon={<Package className="h-4 w-4" />}
                    label={copy.listings}
                    value={String(activeCards.length)}
                    hint={fill(copy.listingsHint, { count: soldCount })}
                />
                {!isOwner && (
                    <StatTile
                        icon={<CheckCircle className="h-4 w-4" />}
                        label={copy.soldStat}
                        value={formatCompactCount(soldCount, locale)}
                        hint={copy.soldStatHint}
                        accent="text-green-500"
                    />
                )}
                <StatTile
                    icon={<Shield className="h-4 w-4" />}
                    label={copy.legitScore}
                    value={`${identity.legitRate}`}
                    suffix="/100"
                    hint={fill(copy.legitHint, {
                        completed: identity.completedTransactions,
                        total: identity.totalTransactions,
                    })}
                    accent={legitColor(identity.legitRate)}
                    progress={identity.legitRate}
                />
            </section>

            {/* ── Rank progress ──────────────────────────────────────── */}
            {SHOW_ACCOUNT_RANK && (
                <CardUI className="mb-8">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`grid place-items-center h-11 w-11 rounded-xl ${rank.medal} ${rank.glow}`}>
                                    <RankIcon className="h-5 w-5 text-black/75" strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">{copy.accountRank}</p>
                                    <p className={`font-bold ${rank.text}`}>{rank.name}</p>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground text-right">
                                {nextRank
                                    ? fill(copy.toRankUp, {
                                        count: Math.max(0, nextRank.minSales - soldCount),
                                        rank: nextRank.name,
                                    })
                                    : copy.highestRank}
                            </p>
                        </div>
                        <Progress value={rankProgress} className="h-2" />
                    </CardContent>
                </CardUI>
            )}

            {/* Lives outside the rank card, which is currently hidden: a capped
                total is a caveat about the numbers above, not about the rank. */}
            {isOwner && owner?.truncated && (
                <p className="mb-8 text-xs text-muted-foreground">
                    {fill(copy.approxNote, { cap: owner.rowCap })}
                </p>
            )}

            {/* ── Activity ───────────────────────────────────────────── */}
            <Tabs defaultValue="selling" className="w-full">
                <TabsList className={`grid w-full mb-6 ${isOwner ? "grid-cols-4" : "grid-cols-2"}`}>
                    <TabsTrigger value="selling" className="gap-2">
                        <Tag className="h-4 w-4" />
                        <span className="hidden sm:inline">{copy.sellingTab}</span>
                    </TabsTrigger>
                    <TabsTrigger value="sold" className="gap-2">
                        <CheckCircle className="h-4 w-4" />
                        <span className="hidden sm:inline">{copy.soldTab}</span>
                    </TabsTrigger>
                    {isOwner && (
                        <>
                            <TabsTrigger value="bought" className="gap-2">
                                <ShoppingBag className="h-4 w-4" />
                                <span className="hidden sm:inline">{copy.boughtTab}</span>
                            </TabsTrigger>
                            <TabsTrigger value="transactions" className="gap-2">
                                <Clock className="h-4 w-4" />
                                <span className="hidden sm:inline">{copy.transactionsTab}</span>
                            </TabsTrigger>
                        </>
                    )}
                </TabsList>

                <TabsContent value="selling">
                    {activeCards.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {activeCards.map((card) => (
                                <CardTile
                                    key={card.id}
                                    card={card}
                                    price={formatVnd(card.price)}
                                    priceClass="text-primary"
                                    type={listingTypeChip(card.listingType)}
                                    overlay={card.status === "in_transaction"
                                        ? { label: copy.inTransaction, className: "bg-amber-400 text-black shadow-[0_0_14px_-2px_rgba(251,191,36,0.7)]" }
                                        : null}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Tag className="h-10 w-10" />}
                            message={isOwner ? copy.noSelling : copy.noSellingOther}
                            action={isOwner ? <Button asChild><Link href="/sell/create">{copy.listNow}</Link></Button> : undefined}
                        />
                    )}
                </TabsContent>

                <TabsContent value="sold">
                    {soldCards.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {soldCards.map((card) => (
                                <CardTile
                                    key={card.id}
                                    card={card}
                                    // The agreed sale price, falling back to the ask
                                    // only when the sale predates that column.
                                    price={formatVnd(card.lastSoldPrice ?? card.price)}
                                    priceClass="text-green-500"
                                    type={listingTypeChip(card.listingType)}
                                    overlay={{ label: copy.soldTab, className: "bg-emerald-400 text-black shadow-[0_0_14px_-2px_rgba(52,211,153,0.7)]" }}
                                    dimmed
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<CheckCircle className="h-10 w-10" />}
                            message={isOwner ? copy.noSold : copy.noSoldOther}
                        />
                    )}
                </TabsContent>

                {isOwner && owner && (
                    <>
                        <TabsContent value="bought">
                            {owner.purchases.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                    {owner.purchases.map((tx) => (
                                        <PurchaseTile
                                            key={tx.id}
                                            tx={tx}
                                            price={formatVnd(tx.price)}
                                            fallbackName={copy.unknownCard}
                                            locale={locale}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <EmptyState icon={<ShoppingBag className="h-10 w-10" />} message={copy.noBought}
                                    action={<Button asChild><Link href="/buy">{copy.exploreNow}</Link></Button>} />
                            )}
                        </TabsContent>

                        <TabsContent value="transactions">
                            {owner.transactions.length > 0 ? (
                                <div className="space-y-3">
                                    {owner.transactions.map((tx) => (
                                        <CardUI key={tx.id} className="hover:border-primary/50 transition-colors">
                                            <CardContent className="p-4 flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className={`p-2 rounded-full shrink-0 ${tx.status === "completed" ? "bg-green-500/10"
                                                        : tx.status === "cancelled" || tx.status === "auto_cancelled" ? "bg-red-500/10"
                                                            : "bg-yellow-500/10"
                                                        }`}>
                                                        {tx.status === "completed" ? <CheckCircle className="h-5 w-5 text-green-500" />
                                                            : tx.status === "cancelled" || tx.status === "auto_cancelled" ? <XCircle className="h-5 w-5 text-red-500" />
                                                                : <Clock className="h-5 w-5 text-yellow-500" />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <Badge variant={tx.direction === "sell" ? "default" : "secondary"} className="text-xs">
                                                                {tx.direction === "sell" ? copy.sellType : copy.buyType}
                                                            </Badge>
                                                            <span className="font-medium truncate">
                                                                {tx.cardName || copy.unknownCard}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            {statusLabel(tx.status)} · {new Date(tx.createdAt).toLocaleDateString(locale, {
                                                                day: "2-digit", month: "2-digit", year: "numeric",
                                                            })}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    {/* Signed only when money actually moved. A cancelled
                                                        order showing "+2.000.000 ₫" reads as income. */}
                                                    <p className={`font-bold ${tx.status !== "completed" ? "text-muted-foreground line-through"
                                                        : tx.direction === "sell" ? "text-green-500" : "text-primary"
                                                        }`}>
                                                        {tx.status === "completed" && (tx.direction === "sell" ? "+" : "−")}
                                                        {formatVnd(tx.price)}
                                                    </p>
                                                    <Link
                                                        href={`/transaction/${tx.id}`}
                                                        className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                                                    >
                                                        {copy.details}<ChevronRight className="h-3 w-3" />
                                                    </Link>
                                                </div>
                                            </CardContent>
                                        </CardUI>
                                    ))}
                                </div>
                            ) : (
                                <EmptyState icon={<Clock className="h-10 w-10" />} message={copy.noTransactions} />
                            )}
                        </TabsContent>
                    </>
                )}
            </Tabs>
        </main>
    );
}

function StatTile({ icon, label, value, hint, suffix, accent, progress }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint?: string;
    suffix?: string;
    accent?: string;
    progress?: number;
}) {
    return (
        <CardUI>
            <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    {icon}
                    <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                </div>
                <div className="flex items-baseline gap-1">
                    {/* Money strings run long in VND; let them shrink rather than
                        overflow the tile on a phone. */}
                    <span className={`text-xl md:text-2xl font-bold tabular-nums truncate ${accent ?? ""}`}>
                        {value}
                    </span>
                    {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
                </div>
                {progress !== undefined && <Progress value={progress} className="h-1.5 mt-2" />}
                {hint && <p className="text-xs text-muted-foreground mt-2 truncate">{hint}</p>}
            </CardContent>
        </CardUI>
    );
}

function CardTile({ card, price, priceClass, type, overlay, dimmed }: {
    card: ProfileListingCard;
    price: string;
    priceClass: string;
    type: { label: string; className: string };
    overlay: { label: string; className: string } | null;
    dimmed?: boolean;
}) {
    return (
        <Link href={`/cards/${card.id}`}>
            <CardUI className="group hover:border-primary transition-colors overflow-hidden h-full">
                <div className="relative aspect-[3/4] bg-muted">
                    <Image
                        src={card.imageUrl || "/placeholder.png"}
                        alt={card.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 20vw"
                        className={`object-cover transition-transform group-hover:scale-105 ${dimmed ? "opacity-70" : ""}`}
                    />
                    {overlay && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-end justify-center pb-3">
                            <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${overlay.className}`}>
                                {overlay.label}
                            </span>
                        </div>
                    )}
                    {/* Type sits on the art, where the eye already is, rather than
                        competing with the name and price below it. */}
                    <span className={`absolute top-2 left-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full backdrop-blur-sm ${type.className}`}>
                        {type.label}
                    </span>
                </div>
                <CardContent className="p-3">
                    <p className="font-medium text-sm truncate" title={card.name}>{card.name}</p>
                    <p className={`font-bold tabular-nums truncate ${priceClass}`}>{price}</p>
                </CardContent>
            </CardUI>
        </Link>
    );
}

function PurchaseTile({ tx, price, fallbackName, locale }: {
    tx: ProfileTxRow;
    price: string;
    fallbackName: string;
    locale: string;
}) {
    const body = (
        <CardUI className="group hover:border-primary transition-colors overflow-hidden h-full">
            <div className="relative aspect-[3/4] bg-muted">
                <Image
                    src={tx.cardImage || "/placeholder.png"}
                    alt={tx.cardName || fallbackName}
                    fill
                    sizes="(max-width: 768px) 50vw, 20vw"
                    className="object-cover transition-transform group-hover:scale-105"
                />
            </div>
            <CardContent className="p-3">
                <p className="font-medium text-sm truncate" title={tx.cardName || fallbackName}>
                    {tx.cardName || fallbackName}
                </p>
                <p className="font-bold text-primary tabular-nums truncate">{price}</p>
                {tx.completedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(tx.completedAt).toLocaleDateString(locale, {
                            day: "2-digit", month: "2-digit", year: "numeric",
                        })}
                    </p>
                )}
            </CardContent>
        </CardUI>
    );

    // A purchased card can be delisted or removed; linking to a dead page is
    // worse than not linking at all.
    return tx.cardId ? <Link href={`/cards/${tx.cardId}`}>{body}</Link> : body;
}

function EmptyState({ icon, message, action }: {
    icon: React.ReactNode;
    message: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="text-center py-16 border rounded-xl border-dashed">
            <div className="text-muted-foreground mx-auto mb-3 w-fit">{icon}</div>
            <p className="text-muted-foreground mb-4">{message}</p>
            {action}
        </div>
    );
}
