"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import type { Card, Transaction, UserProfile, UserLegitRate, SellerStats } from "@/lib/types";
import { useCurrency } from "@/contexts/currency-context";
import { Card as CardUI, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
    User, ShoppingBag, Tag, Gavel, Ticket, TrendingUp, TrendingDown,
    Star, Shield, Crown, Award, Package, DollarSign, Clock, CheckCircle,
    XCircle, AlertTriangle, ChevronRight
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useLocalization } from "@/context/localization-context";

// Rank definitions
const RANKS = [
    { name: "Bronze", minSales: 0, icon: Shield, color: "text-orange-600", bgColor: "bg-orange-500/10" },
    { name: "Silver", minSales: 5, icon: Shield, color: "text-gray-400", bgColor: "bg-gray-500/10" },
    { name: "Gold", minSales: 15, icon: Star, color: "text-yellow-500", bgColor: "bg-yellow-500/10" },
    { name: "Platinum", minSales: 30, icon: Award, color: "text-cyan-400", bgColor: "bg-cyan-500/10" },
    { name: "Diamond", minSales: 50, icon: Crown, color: "text-purple-500", bgColor: "bg-purple-500/10" },
];

export default function ProfilePage() {
    const router = useRouter();
    const supabase = useSupabase();
    const { user, profile: userProfile, isLoading: isUserLoading } = useUser();
    const { setOpen } = useAuthModal();
    const { locale } = useLocalization();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [legitRate, setLegitRate] = useState<UserLegitRate | null>(null);
    const [sellerStats, setSellerStats] = useState<SellerStats | null>(null);
    const [myCards, setMyCards] = useState<Card[]>([]);
    const [soldCards, setSoldCards] = useState<Card[]>([]);
    const [buyTransactions, setBuyTransactions] = useState<Transaction[]>([]);
    const [sellTransactions, setSellTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Use centralized currency formatting
    const { formatPrice } = useCurrency();
    const copy = locale === "vi-VN"
        ? {
            loginTitle: "Đăng nhập để xem hồ sơ",
            loginDescription: "Bạn cần đăng nhập để xem thông tin cá nhân và lịch sử giao dịch.",
            loginButton: "Đăng nhập",
            sold: "đã bán",
            bought: "đã mua",
            trusted: "uy tín",
            editProfile: "Chỉnh sửa hồ sơ",
            legitScore: "Điểm uy tín",
            totalRevenue: "Tổng thu nhập",
            fromSoldCards: "Từ {count} thẻ đã bán",
            totalSales: "Tổng bán",
            sellingNow: "Đang bán: {count} thẻ",
            accountRank: "Hạng tài khoản",
            toRankUp: "Còn {count} bán để lên hạng",
            highestRank: "Hạng cao nhất!",
            sellingTab: "Đang bán",
            soldTab: "Đã bán",
            boughtTab: "Đã mua",
            transactionsTab: "Giao dịch",
            inTransaction: "Đang giao dịch",
            auction: "Đấu giá",
            buyNow: "Mua ngay",
            noSelling: "Bạn chưa đăng bán thẻ nào",
            listNow: "Đăng bán ngay",
            boughtBadge: "Đã mua",
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
        }
        : locale === "ja-JP"
            ? {
                loginTitle: "プロフィールを見るにはログインしてください",
                loginDescription: "個人情報と取引履歴を見るにはログインが必要です。",
                loginButton: "ログイン",
                sold: "販売済み",
                bought: "購入済み",
                trusted: "信頼度",
                editProfile: "プロフィールを編集",
                legitScore: "信頼スコア",
                totalRevenue: "総収益",
                fromSoldCards: "{count}枚の販売カードから",
                totalSales: "総販売数",
                sellingNow: "出品中: {count}枚",
                accountRank: "アカウントランク",
                toRankUp: "次のランクまであと{count}件",
                highestRank: "最高ランクです！",
                sellingTab: "出品中",
                soldTab: "販売済み",
                boughtTab: "購入済み",
                transactionsTab: "取引",
                inTransaction: "取引中",
                auction: "オークション",
                buyNow: "今すぐ購入",
                noSelling: "まだカードを出品していません",
                listNow: "今すぐ出品",
                boughtBadge: "購入済み",
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
            }
            : {
                loginTitle: "Log in to view your profile",
                loginDescription: "You need to log in to view your personal information and transaction history.",
                loginButton: "Log in",
                sold: "sold",
                bought: "bought",
                trusted: "trusted",
                editProfile: "Edit profile",
                legitScore: "Trust score",
                totalRevenue: "Total revenue",
                fromSoldCards: "From {count} sold cards",
                totalSales: "Total sales",
                sellingNow: "Selling now: {count} cards",
                accountRank: "Account rank",
                toRankUp: "{count} more sales to rank up",
                highestRank: "Highest rank!",
                sellingTab: "Selling",
                soldTab: "Sold",
                boughtTab: "Bought",
                transactionsTab: "Transactions",
                inTransaction: "In transaction",
                auction: "Auction",
                buyNow: "Buy now",
                noSelling: "You have not listed any cards yet",
                listNow: "List now",
                boughtBadge: "Bought",
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
            };

    // Get user rank based on sales
    const getUserRank = (totalSales: number) => {
        for (let i = RANKS.length - 1; i >= 0; i--) {
            if (totalSales >= RANKS[i].minSales) {
                return RANKS[i];
            }
        }
        return RANKS[0];
    };

    // Get legit rate color
    const getLegitRateColor = (rate: number) => {
        if (rate >= 90) return "text-green-500";
        if (rate >= 70) return "text-yellow-500";
        if (rate >= 50) return "text-orange-500";
        return "text-red-500";
    };

    // Fetch user data
    useEffect(() => {
        if (!user) {
            setIsLoading(false);
            return;
        }

        const fetchData = async () => {
            try {
                // Set profile from auth provider or fetch from profiles table
                if (userProfile) {
                    setProfile({
                        uid: userProfile.id,
                        email: userProfile.email,
                        displayName: userProfile.display_name || '',
                        phoneNumber: userProfile.phone_number || '',
                        address: userProfile.address || '',
                        city: userProfile.city || '',
                        profileImageUrl: userProfile.profile_image_url || '',
                        emailVerified: true,
                        createdAt: userProfile.created_at,
                        updatedAt: userProfile.updated_at,
                    });

                    // Set legit rate from profile data
                    setLegitRate({
                        userId: userProfile.id,
                        rate: userProfile.legit_rate,
                        totalTransactions: userProfile.total_transactions,
                        completedTransactions: userProfile.completed_transactions,
                        cancelledTransactions: userProfile.cancelled_transactions,
                        dailyCancellations: userProfile.daily_cancellations,
                        lastCancellationDate: userProfile.last_cancellation_date || '',
                        lastUpdated: userProfile.updated_at,
                    });
                }

                // Fetch my cards
                try {
                    const { data: cardsData, error } = await supabase
                        .from('cards')
                        .select('*')
                        .eq('seller_id', user.id)
                        .limit(20);

                    if (cardsData && !error) {
                        const allCards: Card[] = (cardsData as any[]).map(c => ({
                            id: c.id,
                            name: c.name,
                            imageUrl: c.image_url || '',
                            imageUrls: c.image_urls,
                            category: c.category,
                            condition: c.condition,
                            listingType: c.listing_type,
                            price: c.price,
                            currentBid: c.current_bid,
                            startingBid: c.starting_bid,
                            auctionEnds: c.auction_ends,
                            ticketPrice: c.ticket_price,
                            razzEntries: c.razz_entries,
                            totalTickets: c.total_tickets,
                            sellerId: c.seller_id,
                            author: c.seller_id,
                            description: c.description,
                            lastSoldPrice: c.last_sold_price,
                            status: c.status,
                            publisher: c.publisher,
                            season: c.season,
                            quantity: c.quantity,
                        }));
                        setMyCards(allCards.filter(c => c.status !== 'sold'));
                        setSoldCards(allCards.filter(c => c.status === 'sold'));
                    }
                } catch (e) {
                    console.log("Error fetching cards:", e);
                }

                // Fetch buy transactions
                try {
                    const { data: buyTxData } = await supabase
                        .from('transactions')
                        .select('*')
                        .eq('buyer_id', user.id)
                        .limit(10);

                    if (buyTxData) {
                        setBuyTransactions((buyTxData as any[]).map(tx => ({
                            id: tx.id,
                            cardId: tx.card_id,
                            sellerId: tx.seller_id,
                            buyerId: tx.buyer_id,
                            offerId: tx.offer_id,
                            price: tx.price,
                            status: tx.status,
                            cancelledBy: tx.cancelled_by,
                            cancellationReason: tx.cancellation_reason,
                            createdAt: tx.created_at,
                            expiresAt: tx.expires_at,
                            completedAt: tx.completed_at,
                            cancelledAt: tx.cancelled_at,
                        })));
                    }
                } catch (e) {
                    console.log("Error fetching buy transactions:", e);
                }

                // Fetch sell transactions
                try {
                    const { data: sellTxData } = await supabase
                        .from('transactions')
                        .select('*')
                        .eq('seller_id', user.id)
                        .limit(10);

                    if (sellTxData) {
                        setSellTransactions((sellTxData as any[]).map(tx => ({
                            id: tx.id,
                            cardId: tx.card_id,
                            sellerId: tx.seller_id,
                            buyerId: tx.buyer_id,
                            offerId: tx.offer_id,
                            price: tx.price,
                            status: tx.status,
                            cancelledBy: tx.cancelled_by,
                            cancellationReason: tx.cancellation_reason,
                            createdAt: tx.created_at,
                            expiresAt: tx.expires_at,
                            completedAt: tx.completed_at,
                            cancelledAt: tx.cancelled_at,
                        })));
                    }
                } catch (e) {
                    console.log("Error fetching sell transactions:", e);
                }

            } catch (error) {
                console.error("Error fetching profile data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [user, userProfile]); // supabase is stable singleton

    // Show login prompt if not logged in
    if (!isUserLoading && !user) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-16 text-center">
                    <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">{copy.loginTitle}</h1>
                    <p className="text-muted-foreground mb-6">
                        {copy.loginDescription}
                    </p>
                    <Button onClick={() => setOpen(true)}>{copy.loginButton}</Button>
                </div>
                <Footer />
            </>
        );
    }

    if (isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8">
                    <Skeleton className="h-64 w-full rounded-2xl mb-6" />
                    <div className="grid md:grid-cols-4 gap-4">
                        <Skeleton className="h-32 rounded-xl" />
                        <Skeleton className="h-32 rounded-xl" />
                        <Skeleton className="h-32 rounded-xl" />
                        <Skeleton className="h-32 rounded-xl" />
                    </div>
                </div>
                <Footer />
            </>
        );
    }

    const rank = getUserRank(sellerStats?.totalSales || 0);
    const RankIcon = rank.icon;
    const currentRankIndex = RANKS.findIndex(r => r.name === rank.name);
    const nextRank = currentRankIndex >= 0 && currentRankIndex < RANKS.length - 1
        ? RANKS[currentRankIndex + 1]
        : null;

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8">
                {/* Profile Header */}
                <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent rounded-2xl p-6 md:p-8 mb-8">
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                        {/* Avatar */}
                        <div className="relative">
                            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden border-4 border-primary/30">
                                {profile?.profileImageUrl ? (
                                    <Image
                                        src={profile.profileImageUrl}
                                        alt={profile.displayName}
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <User className="h-12 w-12 md:h-16 md:w-16 text-primary" />
                                )}
                            </div>
                            <div className={`absolute -bottom-1 -right-1 p-2 rounded-full ${rank.bgColor}`}>
                                <RankIcon className={`h-5 w-5 ${rank.color}`} />
                            </div>
                        </div>

                        {/* User Info */}
                        <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <h1 className="text-2xl md:text-3xl font-bold">
                                    {profile?.displayName || user?.email}
                                </h1>
                                <Badge className={`${rank.bgColor} ${rank.color} border-0`}>
                                    <RankIcon className="h-3 w-3 mr-1" />
                                    {rank.name}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground mb-4">{user?.email}</p>

                            {/* Quick Stats */}
                            <div className="flex flex-wrap gap-4 text-sm">
                                <div className="flex items-center gap-1">
                                    <Package className="h-4 w-4 text-primary" />
                                    <span className="font-medium">{soldCards.length}</span>
                                    <span className="text-muted-foreground">{copy.sold}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <ShoppingBag className="h-4 w-4 text-green-500" />
                                    <span className="font-medium">{buyTransactions.filter(t => t.status === 'completed').length}</span>
                                    <span className="text-muted-foreground">{copy.bought}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Shield className={`h-4 w-4 ${getLegitRateColor(legitRate?.rate || 100)}`} />
                                    <span className={`font-medium ${getLegitRateColor(legitRate?.rate || 100)}`}>
                                        {legitRate?.rate || 100}%
                                    </span>
                                    <span className="text-muted-foreground">{copy.trusted}</span>
                                </div>
                            </div>
                        </div>

                        {/* Edit Profile Button */}
                        <Link href="/profile/edit">
                            <Button variant="outline" className="shrink-0">
                                {copy.editProfile}
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {/* Legit Rate */}
                    <CardUI className="relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-green-500/20 to-transparent rounded-bl-full" />
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Shield className="h-4 w-4" />
                                <span className="text-sm">{copy.legitScore}</span>
                            </div>
                            <div className="flex items-end gap-2">
                                <span className={`text-3xl font-bold ${getLegitRateColor(legitRate?.rate || 100)}`}>
                                    {legitRate?.rate || 100}
                                </span>
                                <span className="text-muted-foreground mb-1">/100</span>
                            </div>
                            <Progress
                                value={legitRate?.rate || 100}
                                className="h-2 mt-2"
                            />
                        </CardContent>
                    </CardUI>

                    {/* Total Revenue */}
                    <CardUI className="relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/20 to-transparent rounded-bl-full" />
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <TrendingUp className="h-4 w-4" />
                                <span className="text-sm">{copy.totalRevenue}</span>
                            </div>
                            <p className="text-2xl md:text-3xl font-bold text-primary truncate">
                                {formatPrice(soldCards.reduce((sum, card) => sum + (card.lastSoldPrice ?? card.price ?? 0), 0))}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {copy.fromSoldCards.replace('{count}', String(soldCards.length))}
                            </p>
                        </CardContent>
                    </CardUI>

                    {/* Total Sales */}
                    <CardUI className="relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-yellow-500/20 to-transparent rounded-bl-full" />
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Package className="h-4 w-4" />
                                <span className="text-sm">{copy.totalSales}</span>
                            </div>
                            <p className="text-3xl font-bold">
                                {soldCards.length}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {copy.sellingNow.replace('{count}', String(myCards.length))}
                            </p>
                        </CardContent>
                    </CardUI>

                    {/* Account Rank */}
                    <CardUI className={`relative overflow-hidden ${rank.bgColor}`}>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-white/10 to-transparent rounded-bl-full" />
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Crown className="h-4 w-4" />
                                <span className="text-sm">{copy.accountRank}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <RankIcon className={`h-8 w-8 ${rank.color}`} />
                                <span className={`text-2xl font-bold ${rank.color}`}>{rank.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {nextRank
                                    ? copy.toRankUp.replace('{count}', String(nextRank.minSales - (sellerStats?.totalSales || 0)))
                                    : copy.highestRank}
                            </p>
                        </CardContent>
                    </CardUI>
                </div>

                {/* Tabs */}
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

                    {/* Selling Tab */}
                    <TabsContent value="selling">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {myCards.length > 0 ? (
                                myCards.map((card) => (
                                    <Link href={`/cards/${card.id}`} key={card.id}>
                                        <CardUI className="group hover:border-primary transition-colors overflow-hidden">
                                            <div className="relative aspect-[3/4]">
                                                <Image
                                                    src={card.imageUrl || "/placeholder.png"}
                                                    alt={card.name}
                                                    fill
                                                    className="object-cover group-hover:scale-105 transition-transform"
                                                />
                                                {card.status === 'sold' && (
                                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                                        <Badge className="bg-green-500">{copy.soldTab}</Badge>
                                                    </div>
                                                )}
                                                {card.status === 'in_transaction' && (
                                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                                        <Badge className="bg-yellow-500">{copy.inTransaction}</Badge>
                                                    </div>
                                                )}
                                            </div>
                                            <CardContent className="p-3">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Badge variant="outline" className="text-xs px-1 py-0">
                                                        {card.listingType === 'auction' ? copy.auction :
                                                            card.listingType === 'razz' ? 'Razz' : copy.buyNow}
                                                    </Badge>
                                                </div>
                                                <p className="font-medium truncate text-sm">{card.name}</p>
                                                <p className="text-primary font-bold">{formatPrice(card.price ?? 0)}</p>
                                            </CardContent>
                                        </CardUI>
                                    </Link>
                                ))
                            ) : (
                                <div className="col-span-full text-center py-12">
                                    <Tag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">{copy.noSelling}</p>
                                    <Button className="mt-4" asChild>
                                        <Link href="/sell/create">{copy.listNow}</Link>
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* Bought Tab */}
                    <TabsContent value="bought">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {buyTransactions.filter(t => t.status === 'completed').length > 0 ? (
                                buyTransactions.filter(t => t.status === 'completed').map((tx) => (
                                    <Link href={`/cards/${tx.cardId}`} key={tx.id}>
                                        <CardUI className="group hover:border-primary transition-colors">
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge className="bg-green-500/10 text-green-500">{copy.boughtBadge}</Badge>
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                </div>
                                                <p className="text-lg font-bold text-primary">{formatPrice(tx.price)}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {tx.completedAt && new Date(tx.completedAt).toLocaleDateString(locale)}
                                                </p>
                                            </CardContent>
                                        </CardUI>
                                    </Link>
                                ))
                            ) : (
                                <div className="col-span-full text-center py-12">
                                    <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">{copy.noBought}</p>
                                    <Button className="mt-4" asChild>
                                        <Link href="/buy">{copy.exploreNow}</Link>
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* Sold Tab */}
                    <TabsContent value="sold">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {soldCards.length > 0 ? (
                                soldCards.map((card) => (
                                    <Link href={`/cards/${card.id}`} key={card.id}>
                                        <CardUI className="group hover:border-primary transition-colors overflow-hidden">
                                            <div className="relative aspect-[3/4]">
                                                <Image
                                                    src={card.imageUrl || "/placeholder.png"}
                                                    alt={card.name}
                                                    fill
                                                    className="object-cover opacity-75"
                                                />
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                    <Badge className="bg-green-500">{copy.soldTab}</Badge>
                                                </div>
                                            </div>
                                            <CardContent className="p-3">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Badge variant="outline" className="text-xs px-1 py-0">
                                                        {card.listingType === 'auction' ? copy.auction :
                                                            card.listingType === 'razz' ? 'Razz' : copy.buyNow}
                                                    </Badge>
                                                </div>
                                                <p className="font-medium truncate text-sm">{card.name}</p>
                                                <p className="text-green-500 font-bold">{formatPrice(card.lastSoldPrice ?? card.price ?? 0)}</p>
                                            </CardContent>
                                        </CardUI>
                                    </Link>
                                ))
                            ) : (
                                <div className="col-span-full text-center py-12">
                                    <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">{copy.noSold}</p>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* Transactions Tab */}
                    <TabsContent value="transactions">
                        <div className="space-y-4">
                            {(buyTransactions.length > 0 || sellTransactions.length > 0) ? (
                                [...buyTransactions.map(tx => ({ ...tx, type: 'buy' as const })),
                                ...sellTransactions.map(tx => ({ ...tx, type: 'sell' as const }))]
                                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                    .map((tx) => (
                                        <CardUI key={tx.id} className="hover:border-primary/50 transition-colors">
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-2 rounded-full ${tx.status === 'completed' ? 'bg-green-500/10' :
                                                            tx.status === 'cancelled' ? 'bg-red-500/10' :
                                                                'bg-yellow-500/10'
                                                            }`}>
                                                            {tx.status === 'completed' ? (
                                                                <CheckCircle className="h-5 w-5 text-green-500" />
                                                            ) : tx.status === 'cancelled' ? (
                                                                <XCircle className="h-5 w-5 text-red-500" />
                                                            ) : (
                                                                <Clock className="h-5 w-5 text-yellow-500" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant={tx.type === 'sell' ? 'default' : 'secondary'} className="text-xs">
                                                                    {tx.type === 'sell' ? copy.sellType : copy.buyType}
                                                                </Badge>
                                                                <p className="font-medium">
                                                                    {tx.status === 'completed' ? copy.completed :
                                                                        tx.status === 'cancelled' ? copy.cancelled :
                                                                            tx.status === 'auto_cancelled' ? copy.expired : copy.processing}
                                                                </p>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground">
                                                                {new Date(tx.createdAt).toLocaleString('vi-VN')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`font-bold text-lg ${tx.type === 'sell' ? 'text-green-500' : 'text-primary'}`}>
                                                            {tx.type === 'sell' ? '+' : '-'}{formatPrice(tx.price)}
                                                        </p>
                                                        <Link
                                                            href={`/transaction/${tx.id}`}
                                                            className="text-sm text-primary hover:underline flex items-center justify-end gap-1"
                                                        >
                                                            {copy.details} <ChevronRight className="h-3 w-3" />
                                                        </Link>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </CardUI>
                                    ))
                            ) : (
                                <div className="text-center py-12">
                                    <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">{copy.noTransactions}</p>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </main>
            <Footer />
        </>
    );
}
