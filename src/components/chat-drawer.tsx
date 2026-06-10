"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import { AlertTriangle, CheckCircle, CreditCard, HandCoins, Inbox, Loader2, MessageCircle, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSupabase, useUser } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { useLocalization } from "@/context/localization-context";

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
    } | null;
};

type ChatMessage = {
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    message_type: "user" | "system" | "offer_auto" | "safety_warning";
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
    amount == null ? "" : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

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
            payNow: "Thanh toán ngay",
            loadingMessages: "Đang tải tin nhắn...",
            you: "Bạn",
            cardVerseUser: "Người dùng CardVerse",
            offerTag: "Đề nghị giá",
            messagePlaceholder: "Nhập tin nhắn... Không chia sẻ Zalo/Facebook/số điện thoại hoặc thanh toán ngoài.",
            safetyBanner: "⚠️ Cảnh báo an toàn: Để tránh lừa đảo, chỉ giao dịch và thanh toán trực tiếp trên CardVerse. Hãy đặc biệt cẩn trọng nếu ai đó yêu cầu chuyển sang Facebook, Zalo hoặc chuyển khoản ngân hàng bên ngoài.",
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
                payNow: "今すぐ支払う",
                loadingMessages: "メッセージを読み込み中...",
                you: "あなた",
                cardVerseUser: "CardVerseユーザー",
                offerTag: "価格オファー",
                messagePlaceholder: "メッセージを入力... Zalo/Facebook/電話番号や外部決済情報は共有しないでください。",
                safetyBanner: "⚠️ 安全に関する警告: 詐欺防止のため、取引と支払いは必ずCardVerse上で行ってください。Facebook、Zalo、または外部銀行送金へ誘導された場合は特に注意してください。",
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
                payNow: "Pay now",
                loadingMessages: "Loading messages...",
                you: "You",
                cardVerseUser: "CardVerse user",
                offerTag: "Price offer",
                messagePlaceholder: "Type a message... Do not share Zalo/Facebook/phone numbers or arrange off-platform payment.",
                safetyBanner: "⚠️ Safety Warning: To protect yourself from scams, only conduct transactions and payments directly on CardVerse. Be highly cautious if asked to move the conversation to Facebook, Zalo, or direct external bank transfers.",
            };
    const [conversations, setConversations] = useState<ConversationItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(initialConversationId || null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [isLoadingConversations, setIsLoadingConversations] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [offer, setOffer] = useState<OfferSummary | null>(null);
    const [isAcceptingOffer, setIsAcceptingOffer] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    const selectedConversation = useMemo(
        () => conversations.find(conversation => conversation.id === selectedId) || null,
        [conversations, selectedId],
    );

    const unreadCount = conversations.filter(conversation => conversation.unread).length;

    const offerId = selectedConversation?.offerId || null;

    const fetchOffer = useCallback(async () => {
        if (!offerId) {
            setOffer(null);
            return;
        }
        const { data } = await supabase
            .from("offers")
            .select("id, price, status, buyer_id, transaction_id")
            .eq("id", offerId)
            .maybeSingle();
        setOffer((data as OfferSummary | null) || null);
    }, [offerId, supabase]);

    useEffect(() => {
        void fetchOffer();
    }, [fetchOffer]);

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
            if (payload.transactionId) {
                router.push(`/transaction/${payload.transactionId}`);
            }
        } catch {
            toast({ variant: "destructive", title: copy.error, description: copy.acceptOfferFailed });
        } finally {
            setIsAcceptingOffer(false);
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
        if (!open || !selectedId) {
            setMessages([]);
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
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages.length, selectedId]);

    const sendMessage = async () => {
        if (!selectedId || !draft.trim() || isSending) return;
        const body = draft.trim();
        setDraft("");
        setIsSending(true);
        try {
            const response = await fetch("/api/chat/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedId, body }),
            });
            const payload = await response.json();
            if (response.status === 422 && (payload.code === "blocked_phone_number" || payload.code === "blocked_external_link")) {
                setDraft(body);
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
            setDraft(body);
            const description = error instanceof Error ? error.message : copy.sendMessageFailed;
            toast({ variant: "destructive", title: copy.sendMessageError, description });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl">
                    <SheetHeader className="border-b px-5 py-4">
                        <SheetTitle className="flex items-center gap-2">
                            <MessageCircle className="h-5 w-5 text-orange-500" />
                            CardVerse Messages
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
                                                    {conversation.unread && <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />}
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
                                                            {selectedConversation.sellerId === user.id ? copy.buyerOffer : copy.yourOffer}
                                                        </p>
                                                        <p className="text-lg font-bold text-orange-400">{formatVND(offer.price)}</p>
                                                        <p className="text-[11px] text-muted-foreground">
                                                            {offer.status === "pending" && copy.offerPending}
                                                            {offer.status === "chosen" && copy.offerChosen}
                                                            {offer.status === "accepted" && copy.offerAccepted}
                                                            {offer.status === "rejected" && copy.offerRejected}
                                                        </p>
                                                    </div>

                                                    {selectedConversation.sellerId === user.id && offer.status === "pending" && (
                                                        <Button
                                                            type="button"
                                                            onClick={() => void handleAcceptOffer()}
                                                            disabled={isAcceptingOffer}
                                                            className="shrink-0 bg-orange-500 text-white hover:bg-orange-600"
                                                        >
                                                            {isAcceptingOffer ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <CheckCircle className="mr-1.5 h-4 w-4" />
                                                            )}
                                                            {copy.acceptOffer}
                                                        </Button>
                                                    )}

                                                    {offer.buyer_id === user.id && offer.status === "chosen" && offer.transaction_id && (
                                                        <Button
                                                            type="button"
                                                            onClick={() => router.push(`/transaction/${offer.transaction_id}`)}
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
                                                                {message.body}
                                                            </div>
                                                        );
                                                    }
                                                    if (system) {
                                                        return (
                                                            <div key={message.id} className="mx-auto max-w-xl rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
                                                                {message.body}
                                                                <p className="mt-1 text-[10px] text-muted-foreground">
                                                                    {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                </p>
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                            <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-6 ${
                                                                mine
                                                                    ? "bg-orange-500 text-white"
                                                                    : offerAuto
                                                                        ? "border border-orange-500/30 bg-orange-500/10 text-orange-100"
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
                                        <div className="flex gap-2">
                                            <Textarea
                                                value={draft}
                                                onChange={event => setDraft(event.target.value)}
                                                onKeyDown={event => {
                                                    if (event.key === "Enter" && !event.shiftKey) {
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
