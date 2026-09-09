"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatDrawer } from "@/components/chat-drawer";
import { MessageCircle, UserX } from "lucide-react";
import Link from "next/link";
import { useLocalization } from "@/context/localization-context";
import { standingFromProfile } from "@/lib/reputation";
import {
    ProfileView,
    type ProfileIdentity,
    type ProfileListingCard,
} from "@/components/profile-view";

/**
 * Someone else's profile.
 *
 * Renders the same `ProfileView` as `/profile` in "visitor" mode, which drops
 * the email, the money tiles and the purchase history. That is not only a
 * design choice: `transactions` and `orders` are closed to non-parties by RLS
 * (20260901000100_rls_orders_transactions_owner_only.sql), so this page could
 * not total a stranger's takings even if it wanted to. Everything it does read
 * — the public columns of `profiles`, and `cards` — is already world-readable,
 * so no privileged route or new migration is involved.
 */
export default function PublicProfilePage() {
    const params = useParams();
    const router = useRouter();
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen: setAuthOpen } = useAuthModal();
    const { toast } = useToast();
    const { locale } = useLocalization();

    const userId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

    const [identity, setIdentity] = useState<ProfileIdentity | null>(null);
    const [listings, setListings] = useState<ProfileListingCard[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [chatOpen, setChatOpen] = useState(false);
    const [chatConversationId, setChatConversationId] = useState<string | null>(null);
    const [startingChat, setStartingChat] = useState(false);

    const copy = locale === "vi-VN"
        ? {
            message: "Nhắn tin",
            notFoundTitle: "Không tìm thấy hồ sơ",
            notFoundBody: "Người dùng này không tồn tại hoặc đã rời khỏi CardVerseHub.",
            backToMarket: "Về chợ thẻ",
            chatError: "Lỗi trò chuyện",
            openChatFailed: "Không mở được đoạn chat. Vui lòng thử lại.",
        }
        : locale === "ja-JP"
            ? {
                message: "メッセージ",
                notFoundTitle: "プロフィールが見つかりません",
                notFoundBody: "このユーザーは存在しないか、CardVerseHubを退会しました。",
                backToMarket: "マーケットへ",
                chatError: "チャットエラー",
                openChatFailed: "チャットを開けませんでした。もう一度お試しください。",
            }
            : {
                message: "Message",
                notFoundTitle: "Profile not found",
                notFoundBody: "This member does not exist or has left CardVerseHub.",
                backToMarket: "Back to the marketplace",
                chatError: "Chat error",
                openChatFailed: "Could not open the chat. Please try again.",
            };

    // Your own profile is the owner page, which shows strictly more.
    useEffect(() => {
        if (userId && user?.id === userId) router.replace("/profile");
    }, [userId, user?.id, router]);

    useEffect(() => {
        if (!userId) {
            setNotFound(true);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const fetchData = async () => {
            try {
                const [profileResult, listingResult] = await Promise.all([
                    // Public columns only. `email`, `phone_number` and every
                    // address column are deliberately absent from this list.
                    supabase
                        .from("profiles")
                        .select(
                            "id, display_name, profile_image_url, seller_verified, " +
                            "seller_review_count, created_at, " +
                            // The four the badge needs. `standingFromProfile` reads a row
                            // without `reputation_score` as "no data" and renders nothing,
                            // so dropping one of these blanks the figure rather than
                            // erroring — hence all four, always, together.
                            "reputation_score, reputation_incidents_90d, " +
                            "reputation_incidents_total, completed_transactions",
                        )
                        .eq("id", userId)
                        .maybeSingle(),
                    supabase
                        .from("cards")
                        .select("id, name, image_url, listing_type, price, last_sold_price, status")
                        .eq("seller_id", userId)
                        .order("created_at", { ascending: false })
                        .limit(60),
                ]);

                if (cancelled) return;

                const row = profileResult.data as Record<string, unknown> | null;
                if (!row) {
                    setNotFound(true);
                    return;
                }

                setIdentity({
                    displayName: (row.display_name as string | null) ?? null,
                    email: null,
                    profileImageUrl: (row.profile_image_url as string | null) ?? null,
                    sellerVerified: Boolean(row.seller_verified),
                    sellerReviewCount: (row.seller_review_count as number | null) ?? 0,
                    standing: standingFromProfile(row),
                    createdAt: (row.created_at as string | null) ?? null,
                });

                setListings(
                    ((listingResult.data as Record<string, unknown>[] | null) ?? []).map((c) => ({
                        id: String(c.id),
                        name: String(c.name ?? ""),
                        imageUrl: (c.image_url as string | null) ?? "",
                        listingType: (c.listing_type as string | null) ?? null,
                        price: (c.price as number | null) ?? null,
                        lastSoldPrice: (c.last_sold_price as number | null) ?? null,
                        status: (c.status as string | null) ?? null,
                    })),
                );
            } catch (error) {
                console.error("[PublicProfile] Failed to load profile:", error);
                if (!cancelled) setNotFound(true);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchData();
        return () => { cancelled = true; };
    }, [userId, supabase]);

    const activeCards = listings.filter((c) => c.status !== "sold");
    const soldCards = listings.filter((c) => c.status === "sold");

    /**
     * Every conversation in this app is scoped to a card — `/api/chat/conversations`
     * requires a `cardId` and derives the other party from that card's seller.
     * There is no such thing as a person-to-person thread, so "Message" opens a
     * thread about this seller's newest active listing; the chat header names
     * that card, so the buyer can see what the thread is attached to. With
     * nothing listed there is no thread to open, and the button is not shown.
     */
    const chatCard = activeCards[0] ?? null;

    const handleStartChat = async () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!chatCard) return;

        setStartingChat(true);
        try {
            const response = await fetch("/api/chat/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cardId: chatCard.id }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.openChatFailed);
            setChatConversationId(payload.conversation.id);
            setChatOpen(true);
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.openChatFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setStartingChat(false);
        }
    };

    if (isLoading) {
        return (
            <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6">
                <Skeleton className="h-40 sm:h-48 w-full rounded-2xl" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 sm:h-32 rounded-xl" />)}
                </div>
                <Skeleton className="h-96 w-full rounded-xl" />
            </div>
        );
    }

    if (notFound || !identity) {
        return (
            <div className="container mx-auto px-4 py-24 text-center">
                <UserX className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                <h1 className="text-2xl font-bold mb-2">{copy.notFoundTitle}</h1>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">{copy.notFoundBody}</p>
                <Button asChild><Link href="/buy">{copy.backToMarket}</Link></Button>
            </div>
        );
    }

    return (
        <>
            <ProfileView
                mode="visitor"
                identity={identity}
                activeCards={activeCards}
                soldCards={soldCards}
                action={chatCard ? (
                    <Button
                        variant="outline"
                        className="shrink-0 w-full sm:w-auto border-primary text-primary hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-colors"
                        onClick={handleStartChat}
                        loading={startingChat}
                        disabled={startingChat}
                    >
                        {startingChat ? null : <MessageCircle className="mr-2 h-4 w-4" />}
                        {copy.message}
                    </Button>
                ) : undefined}
            />

            <ChatDrawer
                open={chatOpen}
                onOpenChange={setChatOpen}
                initialConversationId={chatConversationId}
            />
        </>
    );
}
