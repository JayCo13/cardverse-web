"use client";

import { useEffect, useState } from "react";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { User } from "lucide-react";
import Link from "next/link";
import { useLocalization } from "@/context/localization-context";
import {
    ProfileView,
    type ProfileIdentity,
    type ProfileListingCard,
    type ProfileOwnerExtras,
    type ProfileTxRow,
} from "@/components/profile-view";

/**
 * The account owner's own profile.
 *
 * This page only gathers data; the layout lives in `ProfileView`, which
 * `/users/[id]` renders too. Keeping one component means the public view of a
 * seller cannot drift from what that seller sees of themselves.
 */

/**
 * How many transaction rows a lifetime total is allowed to be built from.
 *
 * Far above any real account, but the page says so rather than quietly
 * reporting a truncated total as the whole figure.
 */
const TOTALS_ROW_CAP = 1000;

const EMPTY_OWNER: ProfileOwnerExtras = {
    grossRevenue: 0,
    totalSpent: 0,
    boughtCount: 0,
    purchases: [],
    transactions: [],
    truncated: false,
    rowCap: TOTALS_ROW_CAP,
};

export default function ProfilePage() {
    const supabase = useSupabase();
    const { user, profile, isLoading: isUserLoading } = useUser();
    const { setOpen } = useAuthModal();
    const { locale } = useLocalization();

    const [listings, setListings] = useState<ProfileListingCard[]>([]);
    const [owner, setOwner] = useState<ProfileOwnerExtras>(EMPTY_OWNER);
    const [isLoading, setIsLoading] = useState(true);

    const copy = locale === "vi-VN"
        ? {
            loginTitle: "Đăng nhập để xem hồ sơ",
            loginDescription: "Bạn cần đăng nhập để xem thông tin cá nhân và lịch sử giao dịch.",
            loginButton: "Đăng nhập",
            editProfile: "Chỉnh sửa hồ sơ",
        }
        : locale === "ja-JP"
            ? {
                loginTitle: "プロフィールを見るにはログインしてください",
                loginDescription: "個人情報と取引履歴を見るにはログインが必要です。",
                loginButton: "ログイン",
                editProfile: "プロフィールを編集",
            }
            : {
                loginTitle: "Log in to view your profile",
                loginDescription: "You need to log in to view your personal information and transaction history.",
                loginButton: "Log in",
                editProfile: "Edit profile",
            };

    useEffect(() => {
        if (!user) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const fetchData = async () => {
            try {
                // Cards for the grids, and transactions for both the history and
                // the money totals. Totals come from transactions rather than
                // from listing prices: a listing price is what was asked, the
                // transaction price is what was actually agreed.
                //
                // The sales COUNT is not taken from here — `ProfileView` reads
                // `profiles.seller_review_count` so that the number matches what
                // every listing already shows for this seller.
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

                const toTx = (row: Record<string, unknown>, direction: "buy" | "sell"): ProfileTxRow => {
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

                const cards: ProfileListingCard[] = rows(listingResult).map((c) => ({
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
                const sum = (list: ProfileTxRow[]) => list.reduce((total, t) => total + (t.price ?? 0), 0);

                setListings(cards);
                setOwner({
                    grossRevenue: sum(completedSells),
                    totalSpent: sum(completedBuys),
                    boughtCount: completedBuys.length,
                    purchases: completedBuys,
                    transactions: [...sells, ...buys].sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                    ),
                    truncated: sells.length >= TOTALS_ROW_CAP || buys.length >= TOTALS_ROW_CAP,
                    rowCap: TOTALS_ROW_CAP,
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
            <div className="container mx-auto px-4 py-24 text-center">
                <User className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                <h1 className="text-2xl font-bold mb-2">{copy.loginTitle}</h1>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">{copy.loginDescription}</p>
                <Button onClick={() => setOpen(true)}>{copy.loginButton}</Button>
            </div>
        );
    }

    if (isLoading || isUserLoading) {
        return (
            <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6">
                <Skeleton className="h-40 sm:h-48 w-full rounded-2xl" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 sm:h-32 rounded-xl" />)}
                </div>
                <Skeleton className="h-96 w-full rounded-xl" />
            </div>
        );
    }

    const identity: ProfileIdentity = {
        displayName: profile?.display_name ?? user?.email ?? null,
        email: user?.email ?? null,
        profileImageUrl: profile?.profile_image_url ?? null,
        sellerVerified: profile?.seller_verified ?? false,
        sellerRating: profile?.seller_rating ?? 0,
        sellerReviewCount: profile?.seller_review_count ?? 0,
        legitRate: profile?.legit_rate ?? 100,
        totalTransactions: profile?.total_transactions ?? 0,
        completedTransactions: profile?.completed_transactions ?? 0,
        createdAt: profile?.created_at ?? null,
    };

    return (
        <ProfileView
            mode="owner"
            identity={identity}
            activeCards={listings.filter((c) => c.status !== "sold")}
            soldCards={listings.filter((c) => c.status === "sold")}
            owner={owner}
            action={
                <Button
                    variant="outline"
                    className="shrink-0 w-full sm:w-auto hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-colors"
                    asChild
                >
                    <Link href="/profile/edit">{copy.editProfile}</Link>
                </Button>
            }
        />
    );
}
