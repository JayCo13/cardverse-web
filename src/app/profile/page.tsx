"use client";

import { useEffect, useState } from "react";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { Card as CardUI, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
    User, ShoppingBag, Tag, Star, Shield, Crown, Award, Package,
    Clock, CheckCircle, XCircle, ChevronRight, BadgeCheck, CalendarDays, Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useLocalization } from "@/context/localization-context";

/**
 * Money on this page is never converted.
 *
 * Marketplace listings and transactions are entered and stored in VND — see
 * `priceIsVnd` on the buy and card-detail pages. `useCurrency().formatPrice`
 * takes a USD amount and multiplies by the exchange rate, so passing a stored
 * price through it rendered a 300.000 ₫ card as 7.635.000.000 ₫. Format the
 * stored number directly, exactly as `/cards/[id]` does.
 */
const formatVnd = (amount: number | null | undefined) =>
    amount === null || amount === undefined
        ? "—"
        : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

/** Rank thresholds, measured in completed sales. */
const RANKS = [
    { name: "Bronze", minSales: 0, icon: Shield, color: "text-orange-500", bgColor: "bg-orange-500/10", ring: "ring-orange-500/40" },
    { name: "Silver", minSales: 5, icon: Shield, color: "text-zinc-300", bgColor: "bg-zinc-400/10", ring: "ring-zinc-400/40" },
    { name: "Gold", minSales: 15, icon: Star, color: "text-yellow-500", bgColor: "bg-yellow-500/10", ring: "ring-yellow-500/40" },
    { name: "Platinum", minSales: 30, icon: Award, color: "text-cyan-400", bgColor: "bg-cyan-500/10", ring: "ring-cyan-500/40" },
    { name: "Diamond", minSales: 50, icon: Crown, color: "text-purple-400", bgColor: "bg-purple-500/10", ring: "ring-purple-500/40" },
];

/**
 * Ceiling on the rows summed for lifetime totals.
 *
 * Far above any real account, but the page says so rather than quietly
 * reporting a truncated total as the whole figure.
 */
const TOTALS_ROW_CAP = 1000;

type ListingCard = {
    id: string;
    name: string;
    imageUrl: string;
    listingType: string | null;
    price: number | null;
    lastSoldPrice: number | null;
    status: string | null;
};

type TxRow = {
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

type Totals = {
    activeListings: number;
    soldCount: number;
    grossRevenue: number;
    boughtCount: number;
    totalSpent: number;
    /** True when a lifetime total was computed from a capped row set. */
    truncated: boolean;
};

const EMPTY_TOTALS: Totals = {
    activeListings: 0, soldCount: 0, grossRevenue: 0,
    boughtCount: 0, totalSpent: 0, truncated: false,
};

export default function ProfilePage() {
    const supabase = useSupabase();
    const { user, profile, isLoading: isUserLoading } = useUser();
    const { setOpen } = useAuthModal();
    const { locale } = useLocalization();

    const [listings, setListings] = useState<ListingCard[]>([]);
    const [transactions, setTransactions] = useState<TxRow[]>([]);
    const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
    const [isLoading, setIsLoading] = useState(true);

    const copy = locale === "vi-VN"
        ? {
            loginTitle: "Đăng nhập để xem hồ sơ",
            loginDescription: "Bạn cần đăng nhập để xem thông tin cá nhân và lịch sử giao dịch.",
            loginButton: "Đăng nhập",
            editProfile: "Chỉnh sửa hồ sơ",
            verifiedSeller: "Người bán đã xác minh",
            memberSince: "Thành viên từ {date}",
            noReviews: "Chưa có đánh giá",
            reviewCount: "{count} đánh giá",
            revenue: "Doanh thu",
            revenueHint: "Từ {count} đơn đã hoàn tất",
            spent: "Đã chi",
            spentHint: "Qua {count} đơn đã mua",
            listings: "Đang bán",
            listingsHint: "{count} thẻ đã bán xong",
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
                loginTitle: "プロフィールを見るにはログインしてください",
                loginDescription: "個人情報と取引履歴を見るにはログインが必要です。",
                loginButton: "ログイン",
                editProfile: "プロフィールを編集",
                verifiedSeller: "認証済み出品者",
                memberSince: "{date} から利用",
                noReviews: "レビューなし",
                reviewCount: "レビュー{count}件",
                revenue: "売上",
                revenueHint: "完了した{count}件から",
                spent: "支出",
                spentHint: "購入{count}件",
                listings: "出品中",
                listingsHint: "販売済み{count}枚",
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
                loginTitle: "Log in to view your profile",
                loginDescription: "You need to log in to view your personal information and transaction history.",
                loginButton: "Log in",
                editProfile: "Edit profile",
                verifiedSeller: "Verified seller",
                memberSince: "Member since {date}",
                noReviews: "No reviews yet",
                reviewCount: "{count} reviews",
                revenue: "Revenue",
                revenueHint: "From {count} completed orders",
                spent: "Spent",
                spentHint: "Across {count} purchases",
                listings: "Listed",
                listingsHint: "{count} cards sold",
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

    const rankFor = (sales: number) =>
        [...RANKS].reverse().find((r) => sales >= r.minSales) ?? RANKS[0];

    const legitColor = (rate: number) =>
        rate >= 90 ? "text-green-500"
            : rate >= 70 ? "text-yellow-500"
                : rate >= 50 ? "text-orange-500"
                    : "text-red-500";

    useEffect(() => {
        if (!user) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const fetchData = async () => {
            try {
                // Cards for the grids, and transactions for both the history and
                // the lifetime totals. Totals come from transactions rather than
                // from listing prices: a listing price is what was asked, the
                // transaction price is what was actually agreed.
                const [listingResult, sellResult, buyResult] = await Promise.all([
                    supabase
                        .from("cards")
                        .select("id, name, image_url, listing_type, price, last_sold_price, status")
                        .eq("seller_id", user.id)
                        .order("created_at", { ascending: false })
                        .limit(60),
                    supabase
                        .from("transactions")
                        .select("id, card_id, price, status, created_at, completed_at, cards(name, image_url)")
                        .eq("seller_id", user.id)
                        .order("created_at", { ascending: false })
                        .limit(TOTALS_ROW_CAP),
                    supabase
                        .from("transactions")
                        .select("id, card_id, price, status, created_at, completed_at, cards(name, image_url)")
                        .eq("buyer_id", user.id)
                        .order("created_at", { ascending: false })
                        .limit(TOTALS_ROW_CAP),
                ]);

                if (cancelled) return;

                const rows = (result: { data: unknown }) =>
                    (result.data as Record<string, unknown>[] | null) ?? [];

                const toTx = (row: Record<string, unknown>, direction: "buy" | "sell"): TxRow => {
                    const card = row.cards as { name?: string; image_url?: string } | null;
                    return {
                        id: String(row.id),
                        cardId: (row.card_id as string | null) ?? null,
                        cardName: card?.name ?? null,
                        cardImage: card?.image_url ?? null,
                        price: (row.price as number | null) ?? null,
                        status: (row.status as string | null) ?? null,
                        createdAt: String(row.created_at),
                        completedAt: (row.completed_at as string | null) ?? null,
                        direction,
                    };
                };

                const sells = rows(sellResult).map((r) => toTx(r, "sell"));
                const buys = rows(buyResult).map((r) => toTx(r, "buy"));

                const cards: ListingCard[] = rows(listingResult).map((c) => ({
                    id: String(c.id),
                    name: String(c.name ?? ""),
                    imageUrl: (c.image_url as string | null) ?? "",
                    listingType: (c.listing_type as string | null) ?? null,
                    price: (c.price as number | null) ?? null,
                    lastSoldPrice: (c.last_sold_price as number | null) ?? null,
                    status: (c.status as string | null) ?? null,
                }));

                const completedSells = sells.filter((t) => t.status === "completed");
                const completedBuys = buys.filter((t) => t.status === "completed");
                const sum = (list: TxRow[]) => list.reduce((total, t) => total + (t.price ?? 0), 0);

                setListings(cards);
                setTransactions([...sells, ...buys].sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                ));
                setTotals({
                    activeListings: cards.filter((c) => c.status !== "sold").length,
                    soldCount: completedSells.length,
                    grossRevenue: sum(completedSells),
                    boughtCount: completedBuys.length,
                    totalSpent: sum(completedBuys),
                    truncated: sells.length >= TOTALS_ROW_CAP || buys.length >= TOTALS_ROW_CAP,
                });
            } catch (error) {
                console.error("[Profile] Failed to load profile data:", error);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchData();
        return () => { cancelled = true; };
    }, [user, supabase]);

    if (!isUserLoading && !user) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-24 text-center">
                    <User className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">{copy.loginTitle}</h1>
                    <p className="text-muted-foreground mb-6 max-w-md mx-auto">{copy.loginDescription}</p>
                    <Button onClick={() => setOpen(true)}>{copy.loginButton}</Button>
                </div>
                <Footer />
            </>
        );
    }

    if (isLoading || isUserLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8 space-y-6">
                    <Skeleton className="h-48 w-full rounded-2xl" />
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
                    </div>
                    <Skeleton className="h-96 w-full rounded-xl" />
                </div>
                <Footer />
            </>
        );
    }

    const legitRate = profile?.legit_rate ?? 100;
    const rank = rankFor(totals.soldCount);
    const RankIcon = rank.icon;
    const rankIndex = RANKS.findIndex((r) => r.name === rank.name);
    const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;
    const rankProgress = nextRank
        ? Math.min(100, ((totals.soldCount - rank.minSales) / (nextRank.minSales - rank.minSales)) * 100)
        : 100;

    const rating = profile?.seller_rating ?? null;
    const reviewCount = profile?.seller_review_count ?? 0;
    const joinedAt = profile?.created_at
        ? new Date(profile.created_at).toLocaleDateString(locale, { month: "long", year: "numeric" })
        : null;

    const soldCards = listings.filter((c) => c.status === "sold");
    const activeCards = listings.filter((c) => c.status !== "sold");
    const purchases = transactions.filter((t) => t.direction === "buy" && t.status === "completed");

    const listingTypeLabel = (type: string | null) =>
        type === "auction" ? copy.auction : type === "razz" ? copy.razz : copy.buyNow;

    const statusLabel = (status: string | null) =>
        status === "completed" ? copy.completed
            : status === "cancelled" ? copy.cancelled
                : status === "auto_cancelled" ? copy.expired
                    : copy.processing;

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8">
                {/* ── Identity ───────────────────────────────────────────── */}
                <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 md:p-8 mb-6">
                    <div className="flex flex-col sm:flex-row items-start gap-6">
                        <div className="relative shrink-0">
                            <div className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden bg-muted ring-4 ${rank.ring}`}>
                                {profile?.profile_image_url ? (
                                    <Image
                                        src={profile.profile_image_url}
                                        alt={profile.display_name || ""}
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
                            <div className={`absolute -bottom-1 -right-1 p-2 rounded-full ${rank.bgColor} ring-2 ring-background`}>
                                <RankIcon className={`h-4 w-4 ${rank.color}`} />
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h1 className="text-2xl md:text-3xl font-bold truncate">
                                    {profile?.display_name || user?.email}
                                </h1>
                                {profile?.seller_verified && (
                                    <Badge className="bg-sky-500/10 text-sky-400 border-0 gap-1">
                                        <BadgeCheck className="h-3.5 w-3.5" />
                                        {copy.verifiedSeller}
                                    </Badge>
                                )}
                                <Badge className={`${rank.bgColor} ${rank.color} border-0 gap-1`}>
                                    <RankIcon className="h-3 w-3" />
                                    {rank.name}
                                </Badge>
                            </div>

                            <p className="text-sm text-muted-foreground mb-3 truncate">{user?.email}</p>

                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                                <span className="flex items-center gap-1.5">
                                    {rating !== null ? (
                                        <>
                                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                            <span className="font-semibold">{rating.toFixed(1)}</span>
                                            <span className="text-muted-foreground">
                                                {fill(copy.reviewCount, { count: reviewCount })}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <Star className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-muted-foreground">{copy.noReviews}</span>
                                        </>
                                    )}
                                </span>
                                {joinedAt && (
                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                        <CalendarDays className="h-4 w-4" />
                                        {fill(copy.memberSince, { date: joinedAt })}
                                    </span>
                                )}
                            </div>
                        </div>

                        <Button variant="outline" className="shrink-0 w-full sm:w-auto" asChild>
                            <Link href="/profile/edit">{copy.editProfile}</Link>
                        </Button>
                    </div>
                </section>

                {/* ── Numbers ────────────────────────────────────────────── */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <StatTile
                        icon={<Wallet className="h-4 w-4" />}
                        label={copy.revenue}
                        value={formatVnd(totals.grossRevenue)}
                        hint={fill(copy.revenueHint, { count: totals.soldCount })}
                        accent="text-green-500"
                    />
                    <StatTile
                        icon={<ShoppingBag className="h-4 w-4" />}
                        label={copy.spent}
                        value={formatVnd(totals.totalSpent)}
                        hint={fill(copy.spentHint, { count: totals.boughtCount })}
                    />
                    <StatTile
                        icon={<Package className="h-4 w-4" />}
                        label={copy.listings}
                        value={String(totals.activeListings)}
                        hint={fill(copy.listingsHint, { count: totals.soldCount })}
                    />
                    <StatTile
                        icon={<Shield className="h-4 w-4" />}
                        label={copy.legitScore}
                        value={`${legitRate}`}
                        suffix="/100"
                        hint={fill(copy.legitHint, {
                            completed: profile?.completed_transactions ?? 0,
                            total: profile?.total_transactions ?? 0,
                        })}
                        accent={legitColor(legitRate)}
                        progress={legitRate}
                    />
                </section>

                {/* ── Rank progress ──────────────────────────────────────── */}
                <CardUI className="mb-8">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`p-2.5 rounded-xl ${rank.bgColor}`}>
                                    <RankIcon className={`h-5 w-5 ${rank.color}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">{copy.accountRank}</p>
                                    <p className={`font-bold ${rank.color}`}>{rank.name}</p>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground text-right">
                                {nextRank
                                    ? fill(copy.toRankUp, {
                                        count: Math.max(0, nextRank.minSales - totals.soldCount),
                                        rank: nextRank.name,
                                    })
                                    : copy.highestRank}
                            </p>
                        </div>
                        <Progress value={rankProgress} className="h-2" />
                        {totals.truncated && (
                            <p className="text-xs text-muted-foreground mt-3">
                                {fill(copy.approxNote, { cap: TOTALS_ROW_CAP })}
                            </p>
                        )}
                    </CardContent>
                </CardUI>

                {/* ── Activity ───────────────────────────────────────────── */}
                <Tabs defaultValue="selling" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 mb-6">
                        <TabsTrigger value="selling" className="gap-2">
                            <Tag className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.sellingTab}</span>
                        </TabsTrigger>
                        <TabsTrigger value="sold" className="gap-2">
                            <CheckCircle className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.soldTab}</span>
                        </TabsTrigger>
                        <TabsTrigger value="bought" className="gap-2">
                            <ShoppingBag className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.boughtTab}</span>
                        </TabsTrigger>
                        <TabsTrigger value="transactions" className="gap-2">
                            <Clock className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.transactionsTab}</span>
                        </TabsTrigger>
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
                                        typeLabel={listingTypeLabel(card.listingType)}
                                        overlay={card.status === "in_transaction" ? copy.inTransaction : null}
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState icon={<Tag className="h-10 w-10" />} message={copy.noSelling}
                                action={<Button asChild><Link href="/sell/create">{copy.listNow}</Link></Button>} />
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
                                        typeLabel={listingTypeLabel(card.listingType)}
                                        overlay={copy.soldTab}
                                        dimmed
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState icon={<CheckCircle className="h-10 w-10" />} message={copy.noSold} />
                        )}
                    </TabsContent>

                    <TabsContent value="bought">
                        {purchases.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                {purchases.map((tx) => (
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
                        {transactions.length > 0 ? (
                            <div className="space-y-3">
                                {transactions.map((tx) => (
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
                </Tabs>
            </main>
            <Footer />
        </>
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

function CardTile({ card, price, priceClass, typeLabel, overlay, dimmed }: {
    card: ListingCard;
    price: string;
    priceClass: string;
    typeLabel: string;
    overlay: string | null;
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
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Badge className="bg-green-500">{overlay}</Badge>
                        </div>
                    )}
                </div>
                <CardContent className="p-3">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 mb-1.5">{typeLabel}</Badge>
                    <p className="font-medium text-sm truncate" title={card.name}>{card.name}</p>
                    <p className={`font-bold tabular-nums truncate ${priceClass}`}>{price}</p>
                </CardContent>
            </CardUI>
        </Link>
    );
}

function PurchaseTile({ tx, price, fallbackName, locale }: {
    tx: TxRow;
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
