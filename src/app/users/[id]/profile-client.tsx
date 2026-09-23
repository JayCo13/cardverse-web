"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ChatDrawer } from "@/components/chat-drawer";
import { MessageCircle, UserX } from "lucide-react";
import Link from "next/link";
import { useLocalization } from "@/context/localization-context";
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
 * not total a stranger's takings even if it wanted to. The server page supplies
 * only public profile and visible-listing fields; no privileged route or new
 * migration is involved.
 */
export default function PublicProfileClient({ userId, identity, listings }: {
    userId: string;
    identity: ProfileIdentity | null;
    listings: ProfileListingCard[];
}) {
    const router = useRouter();
    const { user } = useUser();
    const { setOpen: setAuthOpen } = useAuthModal();
    const { toast } = useToast();
    const { locale } = useLocalization();

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

    if (!identity) {
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
