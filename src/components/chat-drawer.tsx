"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import { AlertTriangle, Bell, BellOff, CheckCircle, CreditCard, HandCoins, Image as ImageIcon, Inbox, Loader2, MessageCircle, Send, ShieldAlert, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSupabase, useUser } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCloudinarySignature, uploadImageDirectToCloudinary } from "@/lib/cloudinary-direct";
import { useLocalization } from "@/context/localization-context";

// Curated emoji set for the lightweight inline picker (no extra dependency).
const CHAT_EMOJIS = [
    "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "🥳",
    "🙂", "🤔", "😅", "😉", "😌", "😴", "🤝", "👍", "👎", "👌",
    "🙏", "👏", "💪", "🔥", "✨", "⭐", "❤️", "💯", "🎉", "🤑",
    "😢", "😭", "😡", "😱", "🤗", "🫶", "💰", "💸", "📦", "🃏",
];

type ConversationItem = {
    id: string;
    buyerId: string;
    sellerId: string;
    cardId: string | null;
    offerId: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    buyerLastReadAt: string | null;
    sellerLastReadAt: string | null;
    unread: boolean;
    muted: boolean;
    otherUser: {
        id: string;
        display_name: string | null;
        email: string | null;
        profile_image_url: string | null;
        seller_verified?: boolean | null;
    } | null;
    card: {
        id: string;
        name: string;
        image_url: string | null;
        price: number | null;
        status: string | null;
        seller_id?: string | null;
    } | null;
};

type ChatMessage = {
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    message_type: "user" | "system" | "offer_auto" | "safety_warning" | "image";
    metadata: Record<string, unknown>;
    flagged_terms: string[];
    created_at: string;
};

type OfferSummary = {
    id: string;
    price: number;
    status: "pending" | "accepted" | "rejected" | "chosen";
    buyer_id: string;
    transaction_id: string | null;
};

type ChatDrawerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialConversationId?: string | null;
};

const formatVND = (amount: number | null | undefined) =>
    amount == null ? "" : `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;

export function ChatDrawer({ open, onOpenChange, initialConversationId }: ChatDrawerProps) {
    const supabase = useSupabase();
    const { user } = useUser();
    const { toast } = useToast();
    const router = useRouter();
    const { locale } = useLocalization();
    const dateLocale = locale === "vi-VN" ? vi : locale === "ja-JP" ? ja : enUS;
    const copy = locale === "vi-VN"
        ? {
            acceptOfferFailed: "Không thể chấp nhận đề nghị",
            pleaseRetry: "Vui lòng thử lại.",
            error: "Lỗi",
            chatError: "Lỗi chat",
            loadConversationsFailed: "Không thể tải hội thoại",
            loadMessagesFailed: "Không thể tải tin nhắn",
            blockedMessageTitle: "Không thể gửi link hoặc số điện thoại",
            blockedMessageDescription: "Vui lòng trao đổi và thanh toán trực tiếp trên CardVerse để tránh scam.",
            sendMessageFailed: "Không thể gửi tin nhắn",
            safetyAlertTitle: "Cảnh báo an toàn",
            safetyAlertDescription: "Tin nhắn có từ khóa dễ đưa giao dịch ra ngoài nền tảng. Hãy giữ thanh toán trên CardVerse.",
            sendMessageError: "Lỗi gửi tin",
            newCount: "mới",
            loginRequired: "Vui lòng đăng nhập để xem tin nhắn.",
            inboxTitle: "Hộp thư",
            inboxSubtitle: "Quản lý trao đổi với buyer/seller",
            loading: "Đang tải...",
            noConversations: "Chưa có hội thoại nào.",
            marketplaceChat: "Chat giao dịch",
            startConversation: "Bắt đầu hội thoại",
            selectConversation: "Chọn một hội thoại để bắt đầu.",
            withUser: "Với",
            buyerOffer: "Đề nghị từ người mua",
            yourOffer: "Đề nghị của bạn",
            offerPending: "Đang chờ người bán phản hồi",
            offerChosen: "Đã được chấp nhận — chờ thanh toán",
            offerAccepted: "Đã được chấp nhận",
            offerRejected: "Đã bị từ chối",
            acceptOffer: "Chấp nhận đề nghị",
            declineOffer: "Từ chối",
            declineOfferFailed: "Không thể từ chối đề nghị",
            offerMessageLabel: "Lời nhắn",
            offerPriceLabel: "Giá đề nghị",
            offerRejectedMsg: "Đề nghị {price} đã bị từ chối. Người mua có thể gửi offer mới với mức giá cao hơn.",
            offerAcceptedMsg: "Đề nghị {price} đã được chấp nhận. Vào checkout để thanh toán trực tiếp trên CardVerse.",
            offerAcceptedMsgSeller: "Bạn đã chấp nhận đề nghị {price}. Đang chờ người mua vào checkout thanh toán.",
            offerAcceptedToast: "Đã chấp nhận đề nghị",
            offerAcceptedToastDesc: "Người mua sẽ được thông báo để thanh toán.",
            goCheckout: "Vào checkout",
            safetyWarningMsg: "⚠️ CardVerse phát hiện nội dung có thể đưa giao dịch ra ngoài nền tảng. Để tránh scam, hãy trao đổi và thanh toán trực tiếp trên CardVerse.",
            payNow: "Thanh toán ngay",
            loadingMessages: "Đang tải tin nhắn...",
            title: "Tin nhắn CardVerse",
            loadOlderMessages: "Tải tin nhắn cũ hơn",
            you: "Bạn",
            cardVerseUser: "Người dùng CardVerse",
            offerTag: "Đề nghị giá",
            messagePlaceholder: "Nhập tin nhắn... Không chia sẻ Zalo/Facebook/số điện thoại hoặc thanh toán ngoài.",
            safetyBanner: "⚠️ Cảnh báo an toàn: Để tránh lừa đảo, chỉ giao dịch và thanh toán trực tiếp trên CardVerse. Hãy đặc biệt cẩn trọng nếu ai đó yêu cầu chuyển sang Facebook, Zalo hoặc chuyển khoản ngân hàng bên ngoài.",
            muteConversation: "Tắt thông báo đoạn chat",
            unmuteConversation: "Bật thông báo đoạn chat",
            muteUpdateFailed: "Không thể cập nhật thông báo đoạn chat",
            imageButton: "Gửi ảnh",
            emojiButton: "Biểu tượng cảm xúc",
            uploadingImage: "Đang tải ảnh...",
            imageTooLarge: "Ảnh quá lớn (tối đa 8MB).",
            invalidImage: "Tệp không phải ảnh hợp lệ.",
            imageBlockedDescription: "Ảnh chứa số điện thoại bị chặn. Vui lòng giữ giao dịch trên CardVerse.",
            imageAlt: "Hình ảnh đính kèm",
        }
        : locale === "ja-JP"
            ? {
                acceptOfferFailed: "オファーを承認できません",
                pleaseRetry: "もう一度お試しください。",
                error: "エラー",
                chatError: "チャットエラー",
                loadConversationsFailed: "会話を読み込めません",
                loadMessagesFailed: "メッセージを読み込めません",
                blockedMessageTitle: "リンクや電話番号は送信できません",
                blockedMessageDescription: "詐欺防止のため、やり取りと支払いは必ずCardVerse内で行ってください。",
                sendMessageFailed: "メッセージを送信できません",
                safetyAlertTitle: "安全に関する警告",
                safetyAlertDescription: "メッセージに外部取引を促すキーワードが含まれています。支払いはCardVerse内に留めてください。",
                sendMessageError: "送信エラー",
                newCount: "件の新着",
                loginRequired: "メッセージを見るにはログインしてください。",
                inboxTitle: "受信トレイ",
                inboxSubtitle: "購入者・販売者とのやり取りを管理します",
                loading: "読み込み中...",
                noConversations: "会話はまだありません。",
                marketplaceChat: "取引チャット",
                startConversation: "会話を開始",
                selectConversation: "開始する会話を選択してください。",
                withUser: "相手",
                buyerOffer: "購入者からのオファー",
                yourOffer: "あなたのオファー",
                offerPending: "販売者の返信待ち",
                offerChosen: "承認済み — 支払い待ち",
                offerAccepted: "承認済み",
                offerRejected: "却下されました",
                acceptOffer: "オファーを承認",
                declineOffer: "拒否",
                declineOfferFailed: "オファーを拒否できません",
                offerMessageLabel: "メッセージ",
                offerPriceLabel: "提案価格",
                offerRejectedMsg: "{price} のオファーは拒否されました。購入者はより高い金額で再提案できます。",
                offerAcceptedMsg: "{price} のオファーが承認されました。チェックアウトでCardVerse上の支払いを完了してください。",
                offerAcceptedMsgSeller: "{price} のオファーを承認しました。購入者の支払いをお待ちください。",
                offerAcceptedToast: "オファーを承認しました",
                offerAcceptedToastDesc: "購入者に支払いの通知が送られます。",
                goCheckout: "チェックアウトへ",
                safetyWarningMsg: "⚠️ 取引を外部に移す可能性のある内容を検出しました。詐欺防止のため、やり取りと支払いはCardVerse上で行ってください。",
                payNow: "今すぐ支払う",
                loadingMessages: "メッセージを読み込み中...",
                title: "CardVerseメッセージ",
                loadOlderMessages: "以前のメッセージを読み込む",
                you: "あなた",
                cardVerseUser: "CardVerseユーザー",
                offerTag: "価格オファー",
                messagePlaceholder: "メッセージを入力... Zalo/Facebook/電話番号や外部決済情報は共有しないでください。",
                safetyBanner: "⚠️ 安全に関する警告: 詐欺防止のため、取引と支払いは必ずCardVerse上で行ってください。Facebook、Zalo、または外部銀行送金へ誘導された場合は特に注意してください。",
                muteConversation: "このチャットの通知をオフにする",
                unmuteConversation: "このチャットの通知をオンにする",
                muteUpdateFailed: "チャット通知を更新できません",
                imageButton: "画像を送信",
                emojiButton: "絵文字",
                uploadingImage: "画像をアップロード中...",
                imageTooLarge: "画像が大きすぎます（最大8MB）。",
                invalidImage: "有効な画像ファイルではありません。",
                imageBlockedDescription: "画像に電話番号が含まれています。取引はCardVerse内で行ってください。",
                imageAlt: "添付画像",
            }
            : {
                acceptOfferFailed: "Unable to accept offer",
                pleaseRetry: "Please try again.",
                error: "Error",
                chatError: "Chat error",
                loadConversationsFailed: "Unable to load conversations",
                loadMessagesFailed: "Unable to load messages",
                blockedMessageTitle: "Links or phone numbers cannot be sent",
                blockedMessageDescription: "Please keep communication and payment on CardVerse to avoid scams.",
                sendMessageFailed: "Unable to send message",
                safetyAlertTitle: "Safety warning",
                safetyAlertDescription: "This message contains terms that may move the deal off-platform. Keep payment on CardVerse.",
                sendMessageError: "Send error",
                newCount: "new",
                loginRequired: "Please log in to view messages.",
                inboxTitle: "Inbox",
                inboxSubtitle: "Manage conversations with buyers and sellers",
                loading: "Loading...",
                noConversations: "No conversations yet.",
                marketplaceChat: "Marketplace chat",
                startConversation: "Start a conversation",
                selectConversation: "Select a conversation to begin.",
                withUser: "With",
                buyerOffer: "Offer from buyer",
                yourOffer: "Your offer",
                offerPending: "Waiting for seller response",
                offerChosen: "Accepted — awaiting payment",
                offerAccepted: "Accepted",
                offerRejected: "Rejected",
                acceptOffer: "Accept offer",
                declineOffer: "Decline",
                declineOfferFailed: "Unable to decline offer",
                offerMessageLabel: "Message",
                offerPriceLabel: "Offer price",
                offerRejectedMsg: "The {price} offer was declined. The buyer can send a new, higher offer.",
                offerAcceptedMsg: "The {price} offer was accepted. Go to checkout to pay directly on CardVerse.",
                offerAcceptedMsgSeller: "You accepted the {price} offer. Waiting for the buyer to check out.",
                offerAcceptedToast: "Offer accepted",
                offerAcceptedToastDesc: "The buyer will be notified to pay.",
                goCheckout: "Go to checkout",
                safetyWarningMsg: "⚠️ CardVerse detected content that may move the deal off-platform. Keep communication and payment on CardVerse to avoid scams.",
                payNow: "Pay now",
                loadingMessages: "Loading messages...",
                title: "CardVerse Messages",
                loadOlderMessages: "Load older messages",
                you: "You",
                cardVerseUser: "CardVerse user",
                offerTag: "Price offer",
                messagePlaceholder: "Type a message... Do not share Zalo/Facebook/phone numbers or arrange off-platform payment.",
                safetyBanner: "⚠️ Safety Warning: To protect yourself from scams, only conduct transactions and payments directly on CardVerse. Be highly cautious if asked to move the conversation to Facebook, Zalo, or direct external bank transfers.",
                muteConversation: "Mute this conversation",
                unmuteConversation: "Unmute this conversation",
                muteUpdateFailed: "Unable to update conversation notifications",
                imageButton: "Send image",
                emojiButton: "Emoji",
                uploadingImage: "Uploading image...",
                imageTooLarge: "Image is too large (max 8MB).",
                invalidImage: "Not a valid image file.",
                imageBlockedDescription: "The image contains a blocked phone number. Please keep the deal on CardVerse.",
                imageAlt: "Attached image",
            };
    const [conversations, setConversations] = useState<ConversationItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(initialConversationId || null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [draft, setDraft] = useState("");
    const [isLoadingConversations, setIsLoadingConversations] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [showEmoji, setShowEmoji] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [isUpdatingMute, setIsUpdatingMute] = useState(false);
    const [offer, setOffer] = useState<OfferSummary | null>(null);
    const [isAcceptingOffer, setIsAcceptingOffer] = useState(false);
    const [isRejectingOffer, setIsRejectingOffer] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const lastScrolledConversationRef = useRef<string | null>(null);
    // Set when prepending older history so the auto-scroll effect doesn't yank
    // the user back to the bottom.
    const skipAutoScrollRef = useRef(false);
    const draftRef = useRef("");
    const isComposingRef = useRef(false);
    const isSendingRef = useRef(false);
    const selectedIdRef = useRef<string | null>(selectedId);

    const selectedConversation = useMemo(
        () => conversations.find(conversation => conversation.id === selectedId) || null,
        [conversations, selectedId],
    );
    const isSellerInSelectedConversation =
        !!user && !!selectedConversation && (
            selectedConversation.sellerId === user.id ||
            selectedConversation.card?.seller_id === user.id
        );

    const unreadCount = conversations.filter(conversation => conversation.unread).length;

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);
    const latestOfferMessageId = useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const metadata = messages[index].metadata || {};
            const offerId = metadata.offerId || metadata.offer_id;
            if (typeof offerId === "string" && offerId) return offerId;
        }
        return selectedConversation?.offerId || null;
    }, [messages, selectedConversation?.offerId]);

    const fetchOffer = useCallback(async () => {
        if (latestOfferMessageId) {
            // NOTE: offers has no updated_at column — selecting it makes PostgREST
            // error out silently and the offer banner never renders.
            const { data } = await supabase
                .from("offers")
                .select("id, price, status, buyer_id, transaction_id, created_at")
                .eq("id", latestOfferMessageId)
                .in("status", ["pending", "chosen"])
                .maybeSingle();

            if (data) {
                setOffer(data as OfferSummary);
                return;
            }
        }

        if (!selectedConversation?.cardId || !selectedConversation.buyerId) {
            setOffer(null);
            return;
        }

        const { data } = await supabase
            .from("offers")
            .select("id, price, status, buyer_id, transaction_id, created_at")
            .eq("card_id", selectedConversation.cardId)
            .eq("buyer_id", selectedConversation.buyerId)
            .in("status", ["pending", "chosen"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        setOffer((data as OfferSummary | null) || null);
    }, [latestOfferMessageId, selectedConversation?.buyerId, selectedConversation?.cardId, supabase]);

    // Re-fetch the offer whenever a new message lands: offer updates reuse the
    // same offer row (same id), so `latestOfferMessageId` alone won't change and
    // the banner would keep showing the stale price.
    const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
    useEffect(() => {
        void fetchOffer();
    }, [fetchOffer, lastMessageId]);

    // Realtime: watch the offers row itself (price/status changes that don't
    // produce a chat message, e.g. seller accept/reject from card detail).
    useEffect(() => {
        if (!open || !selectedConversation?.cardId) return;
        const channel = supabase
            .channel(`chat-offers-${selectedConversation.cardId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "offers", filter: `card_id=eq.${selectedConversation.cardId}` },
                () => void fetchOffer(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchOffer, open, selectedConversation?.cardId, supabase]);

    const handleAcceptOffer = async () => {
        if (!offer || isAcceptingOffer) return;
        setIsAcceptingOffer(true);
        try {
            const response = await fetch(`/api/offers/${offer.id}/accept`, { method: "POST" });
            const payload = await response.json();
            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.acceptOfferFailed,
                    description: payload.error || copy.pleaseRetry,
                });
                return;
            }
            await fetchOffer();
            // The seller accepts; checkout is the BUYER's step. Never redirect the
            // seller to /checkout (they'd hit "offer forbidden"). Just confirm —
            // the buyer is notified + gets a checkout button on the system message.
            toast({ title: copy.offerAcceptedToast, description: copy.offerAcceptedToastDesc });
        } catch {
            toast({ variant: "destructive", title: copy.error, description: copy.acceptOfferFailed });
        } finally {
            setIsAcceptingOffer(false);
        }
    };

    const handleRejectOffer = async () => {
        if (!offer || isRejectingOffer) return;
        setIsRejectingOffer(true);
        try {
            const response = await fetch(`/api/offers/${offer.id}/reject`, { method: "POST" });
            const payload = await response.json();
            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.declineOfferFailed,
                    description: payload.error || copy.pleaseRetry,
                });
                return;
            }
            await fetchOffer();
        } catch {
            toast({ variant: "destructive", title: copy.error, description: copy.declineOfferFailed });
        } finally {
            setIsRejectingOffer(false);
        }
    };

    const handleToggleMute = async () => {
        if (!selectedConversation || isUpdatingMute) return;
        const conversationId = selectedConversation.id;
        const muted = !selectedConversation.muted;
        setIsUpdatingMute(true);
        try {
            const response = await fetch("/api/chat/conversations", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId, muted }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.muteUpdateFailed);
            setConversations(current => current.map(conversation =>
                conversation.id === conversationId ? { ...conversation, muted } : conversation,
            ));
            window.dispatchEvent(new CustomEvent("cardverse:conversation-muted", {
                detail: { conversationId, muted },
            }));
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.muteUpdateFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setIsUpdatingMute(false);
        }
    };

    const fetchConversations = useCallback(async () => {
        if (!user) return;
        setIsLoadingConversations(true);
        try {
            const response = await fetch("/api/chat/conversations", { cache: "no-store" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.loadConversationsFailed);
            setConversations(payload.conversations || []);
            if (!selectedId && payload.conversations?.[0]) {
                setSelectedId(payload.conversations[0].id);
            }
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.loadConversationsFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setIsLoadingConversations(false);
        }
    }, [selectedId, toast, user]);

    const fetchMessages = useCallback(async (conversationId: string) => {
        setIsLoadingMessages(true);
        try {
            const response = await fetch(`/api/chat/messages?conversationId=${conversationId}`, { cache: "no-store" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.loadMessagesFailed);
            setMessages(payload.messages || []);
            setHasMoreMessages(Boolean(payload.hasMore));
            await fetch("/api/chat/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId }),
            });
            void fetchConversations();
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.loadMessagesFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setIsLoadingMessages(false);
        }
    }, [fetchConversations, toast]);

    const loadOlderMessages = useCallback(async () => {
        const conversationId = selectedIdRef.current;
        const oldest = messages[0];
        if (!conversationId || !oldest || isLoadingOlder) return;
        setIsLoadingOlder(true);
        try {
            const response = await fetch(
                `/api/chat/messages?conversationId=${conversationId}&before=${encodeURIComponent(oldest.created_at)}`,
                { cache: "no-store" },
            );
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.loadMessagesFailed);
            skipAutoScrollRef.current = true;
            setMessages(prev => {
                const existing = new Set(prev.map(message => message.id));
                const older = ((payload.messages || []) as ChatMessage[]).filter(message => !existing.has(message.id));
                return [...older, ...prev];
            });
            setHasMoreMessages(Boolean(payload.hasMore));
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.loadMessagesFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setIsLoadingOlder(false);
        }
    }, [messages, isLoadingOlder, toast]);

    useEffect(() => {
        if (initialConversationId) {
            setSelectedId(initialConversationId);
        }
    }, [initialConversationId]);

    useEffect(() => {
        if (!open || !user) return;
        void fetchConversations();
    }, [fetchConversations, open, user]);

    useEffect(() => {
        if (!open || !user) return;
        const channel = supabase
            .channel(`chat-conversations-${user.id}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `buyer_id=eq.${user.id}` },
                () => void fetchConversations(),
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `seller_id=eq.${user.id}` },
                () => void fetchConversations(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchConversations, open, supabase, user]);

    useEffect(() => {
        // Clear immediately so the scroll-to-bottom effect doesn't act on the
        // previous conversation's messages while the new ones are loading.
        setMessages([]);
        if (!open || !selectedId) {
            return;
        }
        void fetchMessages(selectedId);

        const channel = supabase
            .channel(`chat-messages-${selectedId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
                (payload) => {
                    setMessages(prev => prev.some(message => message.id === payload.new.id)
                        ? prev
                        : [...prev, payload.new as ChatMessage]);
                    void fetch("/api/chat/read", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ conversationId: selectedId }),
                    });
                    void fetchConversations();
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchConversations, fetchMessages, open, selectedId, supabase]);

    useEffect(() => {
        if (isLoadingMessages || messages.length === 0) return;
        if (skipAutoScrollRef.current) {
            // Older history was just prepended — keep the user's position.
            skipAutoScrollRef.current = false;
            return;
        }
        // Jump instantly when opening/switching a conversation; scroll smoothly for
        // new messages within the conversation already in view.
        const switchedConversation = lastScrolledConversationRef.current !== selectedId;
        lastScrolledConversationRef.current = selectedId;
        const behavior: ScrollBehavior = switchedConversation ? "auto" : "smooth";
        // Defer to after layout/paint so the freshly rendered messages are measured.
        const raf = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bottomRef.current?.scrollIntoView({ behavior, block: "end" });
            });
        });
        return () => cancelAnimationFrame(raf);
    }, [messages.length, selectedId, isLoadingMessages]);

    const sendMessage = async () => {
        const conversationId = selectedIdRef.current;
        const body = draftRef.current.trim();
        if (!conversationId || !body || isSendingRef.current) return;

        isSendingRef.current = true;
        draftRef.current = "";
        setDraft("");
        setIsSending(true);

        const restoreDraft = () => {
            if (selectedIdRef.current !== conversationId) return;
            const currentDraft = draftRef.current;
            const restoredDraft = currentDraft.trim() ? `${body}\n${currentDraft}` : body;
            draftRef.current = restoredDraft;
            setDraft(restoredDraft);
        };

        try {
            const response = await fetch("/api/chat/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId, body }),
            });
            const payload = await response.json();
            if (response.status === 422 && (payload.code === "blocked_phone_number" || payload.code === "blocked_external_link")) {
                restoreDraft();
                toast({
                    variant: "destructive",
                    title: copy.blockedMessageTitle,
                    description: copy.blockedMessageDescription,
                });
                return;
            }
            if (!response.ok) throw new Error(payload.error || copy.sendMessageFailed);
            if (payload.flaggedTerms?.length) {
                toast({
                    title: copy.safetyAlertTitle,
                    description: copy.safetyAlertDescription,
                });
            }
        } catch (error) {
            restoreDraft();
            const description = error instanceof Error ? error.message : copy.sendMessageFailed;
            toast({ variant: "destructive", title: copy.sendMessageError, description });
        } finally {
            isSendingRef.current = false;
            setIsSending(false);
        }
    };

    const insertEmoji = (emoji: string) => {
        const next = `${draftRef.current}${emoji}`;
        draftRef.current = next;
        setDraft(next);
    };

    const sendImageMessage = async (file: File) => {
        const conversationId = selectedIdRef.current;
        if (!conversationId || isUploadingImage) return;

        if (!file.type.startsWith("image/")) {
            toast({ variant: "destructive", title: copy.sendMessageError, description: copy.invalidImage });
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            toast({ variant: "destructive", title: copy.sendMessageError, description: copy.imageTooLarge });
            return;
        }

        setIsUploadingImage(true);
        try {
            const signature = await getCloudinarySignature("cardverse/chat");
            const { secureUrl } = await uploadImageDirectToCloudinary(file, signature);

            const response = await fetch("/api/chat/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId,
                    body: "",
                    messageType: "image",
                    metadata: { imageUrl: secureUrl },
                }),
            });
            const payload = await response.json();
            if (response.status === 422 && payload.code === "blocked_phone_number") {
                toast({
                    variant: "destructive",
                    title: copy.blockedMessageTitle,
                    description: copy.imageBlockedDescription,
                });
                return;
            }
            if (!response.ok) throw new Error(payload.error || copy.sendMessageFailed);
            if (payload.flaggedTerms?.length) {
                toast({ title: copy.safetyAlertTitle, description: copy.safetyAlertDescription });
            }
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.sendMessageFailed;
            toast({ variant: "destructive", title: copy.sendMessageError, description });
        } finally {
            setIsUploadingImage(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl">
                    <SheetHeader className="border-b px-5 py-4">
                        <SheetTitle className="flex items-center gap-2">
                            <MessageCircle className="h-5 w-5 text-orange-500" />
                            {copy.title}
                            {unreadCount > 0 && <Badge className="bg-orange-500 text-white">{unreadCount} {copy.newCount}</Badge>}
                        </SheetTitle>
                    </SheetHeader>

                {!user ? (
                    <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                        {copy.loginRequired}
                    </div>
                ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_1fr]">
                        <aside className="min-h-0 border-r">
                            <div className="border-b p-4">
                                <p className="text-sm font-semibold">{copy.inboxTitle}</p>
                                <p className="text-xs text-muted-foreground">{copy.inboxSubtitle}</p>
                            </div>
                            <ScrollArea className="h-[calc(100vh-132px)]">
                                {isLoadingConversations && conversations.length === 0 ? (
                                    <div className="flex items-center justify-center p-6 text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {copy.loading}
                                    </div>
                                ) : conversations.length === 0 ? (
                                    <div className="p-6 text-center text-sm text-muted-foreground">
                                        <Inbox className="mx-auto mb-2 h-8 w-8" />
                                        {copy.noConversations}
                                    </div>
                                ) : (
                                    conversations.map(conversation => (
                                        <button
                                            key={conversation.id}
                                            type="button"
                                            onClick={() => setSelectedId(conversation.id)}
                                            className={`flex w-full gap-3 border-b p-4 text-left transition hover:bg-muted/50 ${selectedId === conversation.id ? "bg-orange-500/10" : ""}`}
                                        >
                                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                                                {conversation.card?.image_url ? (
                                                    <Image src={optimizeCloudinaryUrl(conversation.card.image_url, 160)} alt="" fill className="object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-lg font-bold text-orange-500">
                                                        {(conversation.otherUser?.display_name || conversation.otherUser?.email || "C").charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="truncate text-sm font-semibold">
                                                        {conversation.otherUser?.display_name || conversation.otherUser?.email || "CardVerse user"}
                                                    </p>
                                                    <div className="flex items-center gap-1.5">
                                                        {conversation.muted && <BellOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                        {conversation.unread && <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />}
                                                    </div>
                                                </div>
                                                <p className="truncate text-xs text-muted-foreground">{conversation.card?.name || copy.marketplaceChat}</p>
                                                <p className="mt-1 truncate text-xs">{conversation.lastMessagePreview || copy.startConversation}</p>
                                                {conversation.lastMessageAt && (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true, locale: dateLocale })}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </ScrollArea>
                        </aside>

                        <section className="flex min-h-0 flex-col">
                            {!selectedConversation ? (
                                <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                                    {copy.selectConversation}
                                </div>
                            ) : (
                                <>
                                    <div className="border-b p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-muted">
                                                {selectedConversation.card?.image_url ? (
                                                    <Image src={optimizeCloudinaryUrl(selectedConversation.card.image_url, 160)} alt="" fill className="object-cover" />
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold">{selectedConversation.card?.name || copy.marketplaceChat}</p>
                                                <p className="truncate text-sm text-muted-foreground">
                                                    {copy.withUser} {selectedConversation.otherUser?.display_name || selectedConversation.otherUser?.email || copy.cardVerseUser}
                                                    {selectedConversation.card?.price ? ` · ${formatVND(selectedConversation.card.price)}` : ""}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => void handleToggleMute()}
                                                disabled={isUpdatingMute}
                                                aria-label={selectedConversation.muted ? copy.unmuteConversation : copy.muteConversation}
                                                title={selectedConversation.muted ? copy.unmuteConversation : copy.muteConversation}
                                                className="shrink-0"
                                            >
                                                {isUpdatingMute ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : selectedConversation.muted ? (
                                                    <BellOff className="h-4 w-4" />
                                                ) : (
                                                    <Bell className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
                                            <div className="flex gap-2">
                                                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                <span>{copy.safetyBanner}</span>
                                            </div>
                                        </div>

                                        {offer && (
                                            <div className="mt-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                            <HandCoins className="h-3.5 w-3.5 text-orange-400" />
                                                            {isSellerInSelectedConversation ? copy.buyerOffer : copy.yourOffer}
                                                        </p>
                                                        <p className="text-lg font-bold text-orange-400">{formatVND(offer.price)}</p>
                                                        <p className="text-[11px] text-muted-foreground">
                                                            {offer.status === "pending" && copy.offerPending}
                                                            {offer.status === "chosen" && copy.offerChosen}
                                                            {offer.status === "accepted" && copy.offerAccepted}
                                                            {offer.status === "rejected" && copy.offerRejected}
                                                        </p>
                                                    </div>

                                                    {isSellerInSelectedConversation && offer.status === "pending" && (
                                                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                                                            <Button
                                                                type="button"
                                                                onClick={() => void handleAcceptOffer()}
                                                                disabled={isAcceptingOffer || isRejectingOffer}
                                                                className="bg-orange-500 text-white hover:bg-orange-600"
                                                            >
                                                                {isAcceptingOffer ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <CheckCircle className="mr-1.5 h-4 w-4" />
                                                                )}
                                                                {copy.acceptOffer}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                onClick={() => void handleRejectOffer()}
                                                                disabled={isAcceptingOffer || isRejectingOffer}
                                                                className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                                                            >
                                                                {isRejectingOffer ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <X className="mr-1.5 h-4 w-4" />
                                                                )}
                                                                {copy.declineOffer}
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {offer.buyer_id === user.id && offer.status === "chosen" && (
                                                        <Button
                                                            type="button"
                                                            onClick={() => router.push(`/checkout?offerId=${offer.id}`)}
                                                            className="shrink-0 bg-orange-500 text-white hover:bg-orange-600"
                                                        >
                                                            <CreditCard className="mr-1.5 h-4 w-4" />
                                                            {copy.payNow}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <ScrollArea className="min-h-0 flex-1 p-4">
                                        {isLoadingMessages ? (
                                            <div className="flex items-center justify-center p-6 text-muted-foreground">
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                {copy.loadingMessages}
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {hasMoreMessages && (
                                                    <div className="flex justify-center pb-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 text-xs text-muted-foreground"
                                                            disabled={isLoadingOlder}
                                                            onClick={() => void loadOlderMessages()}
                                                        >
                                                            {isLoadingOlder && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                                            {copy.loadOlderMessages}
                                                        </Button>
                                                    </div>
                                                )}
                                                {messages.map(message => {
                                                    const mine = message.sender_id === user.id;
                                                    const system = message.message_type === "system";
                                                    const offerAuto = message.message_type === "offer_auto";
                                                    const senderLabel = mine
                                                        ? copy.you
                                                        : selectedConversation.otherUser?.display_name || selectedConversation.otherUser?.email || copy.cardVerseUser;
                                                    if (message.message_type === "safety_warning") {
                                                        return (
                                                            <div key={message.id} className="mx-auto max-w-xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                                                                <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-400" />
                                                                {copy.safetyWarningMsg}
                                                            </div>
                                                        );
                                                    }
                                                    if (system) {
                                                        // Render server-generated system messages in the viewer's language
                                                        // (neutral wording works for both buyer and seller); fall back to
                                                        // the stored body for older messages without a `kind`.
                                                        const meta = (message.metadata || {}) as { kind?: string; price?: number; checkoutUrl?: string };
                                                        // Role-aware wording: `mine` = the viewer sent it. An offer_accepted
                                                        // message is sent by the SELLER, so `mine` here means "I'm the seller".
                                                        const systemBody = meta.kind === "offer_rejected" && typeof meta.price === "number"
                                                            ? copy.offerRejectedMsg.replace("{price}", formatVND(meta.price))
                                                            : meta.kind === "offer_accepted" && typeof meta.price === "number"
                                                                ? (mine ? copy.offerAcceptedMsgSeller : copy.offerAcceptedMsg).replace("{price}", formatVND(meta.price))
                                                                : message.body;
                                                        // Checkout is the BUYER's action only.
                                                        const showCheckout = meta.kind === "offer_accepted" && !mine && typeof meta.checkoutUrl === "string";
                                                        return (
                                                            <div key={message.id} className="mx-auto max-w-xl rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
                                                                {systemBody}
                                                                {showCheckout && (
                                                                    <Button
                                                                        size="sm"
                                                                        className="mt-2 h-8 w-full bg-orange-500 text-white hover:bg-orange-600"
                                                                        onClick={() => router.push(meta.checkoutUrl as string)}
                                                                    >
                                                                        {copy.goCheckout}
                                                                    </Button>
                                                                )}
                                                                <p className="mt-1 text-[10px] text-muted-foreground">
                                                                    {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                </p>
                                                            </div>
                                                        );
                                                    }
                                                    if (message.message_type === "image") {
                                                        const imageUrl = typeof message.metadata?.imageUrl === "string" ? message.metadata.imageUrl : null;
                                                        return (
                                                            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                                <div className={`max-w-[78%] overflow-hidden rounded-2xl ${mine ? "bg-orange-500 text-white" : "bg-muted"}`}>
                                                                    <p className={`px-3 pt-2 text-[11px] font-semibold ${mine ? "text-white/80" : "text-muted-foreground"}`}>
                                                                        {senderLabel}
                                                                    </p>
                                                                    {imageUrl && (
                                                                        <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block">
                                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                            <img
                                                                                src={optimizeCloudinaryUrl(imageUrl, 480)}
                                                                                alt={copy.imageAlt}
                                                                                className="max-h-72 w-auto max-w-full object-contain"
                                                                            />
                                                                        </a>
                                                                    )}
                                                                    {message.body && <p className="px-3 pt-2 text-sm leading-6">{message.body}</p>}
                                                                    <p className={`px-3 pb-2 pt-1 text-[10px] ${mine ? "text-white/75" : "text-muted-foreground"}`}>
                                                                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    if (offerAuto) {
                                                        const meta = (message.metadata || {}) as { price?: number; offerText?: string | null; cardName?: string };
                                                        const offerPrice = typeof meta.price === "number" ? meta.price : null;
                                                        const offerText = typeof meta.offerText === "string" ? meta.offerText : null;
                                                        const offerCardName = typeof meta.cardName === "string" ? meta.cardName : null;
                                                        return (
                                                            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                                <div className="max-w-[78%] overflow-hidden rounded-2xl border border-orange-500/30 bg-orange-500/10">
                                                                    <div className="flex items-center gap-1.5 border-b border-orange-500/20 px-3 py-1.5 text-[11px] font-semibold text-orange-300">
                                                                        <HandCoins className="h-3.5 w-3.5" />
                                                                        {senderLabel} · {copy.offerTag}
                                                                    </div>
                                                                    <div className="px-3 py-2">
                                                                        {offerPrice !== null ? (
                                                                            <>
                                                                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{copy.offerPriceLabel}</p>
                                                                                <p className="text-lg font-bold text-orange-400">{formatVND(offerPrice)}</p>
                                                                            </>
                                                                        ) : (
                                                                            <p className="text-sm text-orange-100">{message.body}</p>
                                                                        )}
                                                                        {offerCardName && <p className="mt-0.5 text-xs text-muted-foreground">{offerCardName}</p>}
                                                                        {offerText && (
                                                                            <div className="mt-2 rounded-md bg-background/40 px-2.5 py-1.5">
                                                                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{copy.offerMessageLabel}</p>
                                                                                <p className="text-sm text-foreground">{offerText}</p>
                                                                            </div>
                                                                        )}
                                                                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                                                                            {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                            <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-6 ${
                                                                mine
                                                                    ? "bg-orange-500 text-white"
                                                                    : "bg-muted"
                                                            }`}>
                                                                <p className={`mb-1 text-[11px] font-semibold ${mine ? "text-white/80" : "text-muted-foreground"}`}>
                                                                    {senderLabel}{offerAuto ? ` · ${copy.offerTag}` : ""}
                                                                </p>
                                                                <p>{message.body}</p>
                                                                <p className={`mt-1 text-[10px] ${mine ? "text-white/75" : "text-muted-foreground"}`}>
                                                                    {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div ref={bottomRef} />
                                            </div>
                                        )}
                                    </ScrollArea>

                                    <div className="border-t p-4">
                                        {showEmoji && (
                                            <div className="mb-2 grid grid-cols-10 gap-1 rounded-lg border bg-background p-2">
                                                {CHAT_EMOJIS.map(emoji => (
                                                    <button
                                                        key={emoji}
                                                        type="button"
                                                        className="rounded p-1 text-lg transition-colors hover:bg-muted"
                                                        onClick={() => insertEmoji(emoji)}
                                                    >
                                                        {emoji}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={event => {
                                                const file = event.currentTarget.files?.[0];
                                                event.currentTarget.value = "";
                                                if (file) void sendImageMessage(file);
                                            }}
                                        />
                                        <div className="flex items-end gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={copy.emojiButton}
                                                onClick={() => setShowEmoji(prev => !prev)}
                                                className="h-11 w-11 shrink-0"
                                            >
                                                <Smile className="h-5 w-5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={copy.imageButton}
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={isUploadingImage}
                                                className="h-11 w-11 shrink-0"
                                            >
                                                {isUploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                                            </Button>
                                            <Textarea
                                                value={draft}
                                                onChange={event => {
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                }}
                                                onCompositionStart={() => {
                                                    isComposingRef.current = true;
                                                }}
                                                onCompositionEnd={event => {
                                                    isComposingRef.current = false;
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                }}
                                                onKeyDown={event => {
                                                    if (event.key === "Enter" && !event.shiftKey) {
                                                        const nativeEvent = event.nativeEvent;
                                                        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        void sendMessage();
                                                    }
                                                }}
                                                placeholder={copy.messagePlaceholder}
                                                className="min-h-11 resize-none"
                                                maxLength={2000}
                                            />
                                            <Button
                                                type="button"
                                                onClick={() => void sendMessage()}
                                                disabled={!draft.trim() || isSending}
                                                className="h-11 bg-orange-500 text-white hover:bg-orange-600"
                                            >
                                                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

export function ChatInboxButton() {
    const supabase = useSupabase();
    const { user } = useUser();
    const [open, setOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);

    // Allow any part of the app (e.g. a notification click) to open the inbox
    // on a specific conversation via a window event.
    useEffect(() => {
        const handleOpenChat = (event: Event) => {
            const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
            setRequestedConversationId(detail?.conversationId || null);
            setOpen(true);
        };
        window.addEventListener('cardverse:open-chat', handleOpenChat);
        return () => window.removeEventListener('cardverse:open-chat', handleOpenChat);
    }, []);

    const fetchUnreadCount = useCallback(async () => {
        if (!user) {
            setUnreadCount(0);
            return;
        }

        const { data } = await supabase
            .from("conversations")
            .select("buyer_id, seller_id, last_message_at, buyer_last_read_at, seller_last_read_at")
            .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

        const count = (data || []).filter((conversation: any) => {
            if (!conversation.last_message_at) return false;
            const ownReadAt = conversation.buyer_id === user.id
                ? conversation.buyer_last_read_at
                : conversation.seller_last_read_at;
            return !ownReadAt || new Date(conversation.last_message_at) > new Date(ownReadAt);
        }).length;
        setUnreadCount(count);
    }, [supabase, user]);

    useEffect(() => {
        void fetchUnreadCount();
    }, [fetchUnreadCount]);

    useEffect(() => {
        const handleChatUpdated = () => void fetchUnreadCount();
        window.addEventListener("cardverse:chat-updated", handleChatUpdated);
        return () => window.removeEventListener("cardverse:chat-updated", handleChatUpdated);
    }, [fetchUnreadCount]);

    useEffect(() => {
        if (!user) return;
        const channel = supabase
            .channel(`chat-inbox-count-${user.id}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `buyer_id=eq.${user.id}` },
                () => void fetchUnreadCount(),
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `seller_id=eq.${user.id}` },
                () => void fetchUnreadCount(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchUnreadCount, supabase, user]);

    return (
        <>
            <Button variant="ghost" size="icon" className="relative" onClick={() => setOpen(true)} disabled={!user}>
                <MessageCircle className="h-4 w-4" />
                {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </Button>
            <ChatDrawer open={open} onOpenChange={setOpen} initialConversationId={requestedConversationId} />
        </>
    );
}
