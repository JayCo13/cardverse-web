"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import { AlertTriangle, ArrowLeft, Bell, BellOff, Check, CheckCircle, ChevronDown, Copy, CreditCard, HandCoins, Image as ImageIcon, Inbox, Loader2, MessageCircle, MoreHorizontal, Plus, Send, ShieldAlert, Smile, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSupabase, useUser } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { VerifiedSellerBadge } from "@/components/verified-seller-badge";
import { getCloudinarySignature, uploadImageDirectToCloudinary } from "@/lib/cloudinary-direct";
import { useLocalization } from "@/context/localization-context";

// The Vietnamese placeholder uncaptioned images used to store in
// `conversations.last_message_preview`, kept so old rows still read correctly.
const LEGACY_IMAGE_PREVIEW = "📷 Hình ảnh";

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
    lastMessageType: string | null;
    lastMessageMetadata: Record<string, unknown> | null;
    lastMessageDeleted?: boolean;
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
    deleted_at?: string | null;
};

type OfferSummary = {
    id: string;
    price: number;
    status: "pending" | "accepted" | "rejected" | "chosen" | "expired";
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

/**
 * Put `text` on the clipboard, returning whether it landed.
 *
 * The async Clipboard API is missing or blocked in the two places this feature
 * matters most — Safari on a plain-http origin (a phone testing against a LAN
 * dev server) and older in-app WebViews — so fall back to the selection trick,
 * which those still honour.
 */
async function writeToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Denied or unavailable; the fallback below may still work.
    }
    try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        // Keep it off-screen but still focusable: iOS refuses to copy from a
        // `display: none` or zero-size node.
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.left = "0";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);
        const copied = document.execCommand("copy");
        document.body.removeChild(area);
        return copied;
    } catch {
        return false;
    }
}

/**
 * Explicit copy affordance on a message bubble.
 *
 * Long-pressing to select text inside the chat drawer does not work on a phone:
 * the sheet and the scroll area both claim the gesture before the browser can
 * start a selection, so an address or a code sent in chat was impossible to get
 * out. Touch has no hover to reveal the control, so it stays visible there and
 * only fades in on pointer devices.
 */
function CopyMessageButton({ text, copied, onCopy, onLight, label, copiedLabel }: {
    text: string;
    copied: boolean;
    onCopy: (text: string) => void;
    onLight?: boolean;
    label: string;
    copiedLabel: string;
}) {
    return (
        <button
            type="button"
            aria-label={copied ? copiedLabel : label}
            title={copied ? copiedLabel : label}
            onClick={() => onCopy(text)}
            // `after:` widens the touch target to ~44px without growing the
            // painted button, which would push the bubble's layout around. A
            // 28px tap target is a miss on a phone, and this control only exists
            // for phones.
            className={`relative -my-1 ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity after:absolute after:-inset-2 after:content-[''] md:after:hidden md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 ${
                onLight
                    ? "text-white/75 active:bg-white/25 hover:bg-white/20 hover:text-white"
                    : "text-muted-foreground active:bg-foreground/15 hover:bg-foreground/10 hover:text-foreground"
            }`}
        >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

/**
 * The ⋯ on your own bubble. Same reveal and tap-target rules as
 * `CopyMessageButton` above — hidden until hover on a desktop, always present
 * on a phone, 44px of touch behind a 28px painted control.
 */
function MessageActionsButton({ onLight, label, onRecall, recallLabel }: {
    onLight?: boolean;
    label: string;
    onRecall: () => void;
    recallLabel: string;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    title={label}
                    className={`relative -my-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity after:absolute after:-inset-2 after:content-[''] md:after:hidden md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100 ${
                        onLight
                            ? "text-white/75 active:bg-white/25 hover:bg-white/20 hover:text-white"
                            : "text-muted-foreground active:bg-foreground/15 hover:bg-foreground/10 hover:text-foreground"
                    }`}
                >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={onRecall}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {recallLabel}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

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
            blockedMessageDescription: "Vui lòng trao đổi và thanh toán trực tiếp trên CardVerseHub để tránh scam.",
            sendMessageFailed: "Không thể gửi tin nhắn",
            safetyAlertTitle: "Cảnh báo an toàn",
            safetyAlertDescription: "Tin nhắn có từ khóa dễ đưa giao dịch ra ngoài nền tảng. Hãy giữ thanh toán trên CardVerseHub.",
            sendMessageError: "Lỗi gửi tin",
            newCount: "mới",
            loginRequired: "Vui lòng đăng nhập để xem tin nhắn.",
            inboxTitle: "Hộp thư",
            inboxSubtitle: "Quản lý trao đổi với buyer/seller",
            backToInbox: "Quay lại hộp thư",
            safetyTips: "Mẹo an toàn",
            moreActions: "Thêm tùy chọn",
            sendMessage: "Gửi tin nhắn",
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
            offerExpired: "Đã kết thúc — đơn hàng không hoàn tất",
            acceptOffer: "Chấp nhận đề nghị",
            declineOffer: "Từ chối",
            declineOfferFailed: "Không thể từ chối đề nghị",
            offerMessageLabel: "Lời nhắn",
            offerPriceLabel: "Giá đề nghị",
            offerRejectedMsg: "Đề nghị {price} đã bị từ chối. Người mua có thể gửi offer mới với mức giá cao hơn.",
            offerAcceptedMsg: "Đề nghị {price} đã được chấp nhận. Vào checkout để thanh toán trực tiếp trên CardVerseHub.",
            offerAcceptedMsgSeller: "Bạn đã chấp nhận đề nghị {price}. Đang chờ người mua vào checkout thanh toán.",
            offerAcceptedToast: "Đã chấp nhận đề nghị",
            offerAcceptedToastDesc: "Người mua sẽ được thông báo để thanh toán.",
            goCheckout: "Vào checkout",
            orderPaidMsg: "Bạn đã thanh toán {price}. Đang chờ người bán gửi hàng.",
            orderPaidMsgSeller: "Người mua đã thanh toán {price}. Hãy chuẩn bị gửi hàng.",
            viewOrder: "Xem đơn hàng",
            imagePreview: "📷 Hình ảnh",
            messageRecalled: "Tin nhắn đã được thu hồi",
            recallMessage: "Thu hồi tin nhắn",
            confirmRecallTitle: "Thu hồi tin nhắn này?",
            confirmRecallBody: "Tin nhắn sẽ biến mất ở cả hai phía và chỉ còn lại dòng \"Tin nhắn đã được thu hồi\". Không thể hoàn tác.",
            recallFailed: "Không thu hồi được tin nhắn. Vui lòng thử lại.",
            conversationActions: "Tuỳ chọn đoạn chat",
            deleteConversation: "Xoá đoạn chat",
            confirmDeleteConvTitle: "Xoá đoạn chat này?",
            confirmDeleteConvBody: "Chỉ xoá ở phía bạn — người kia vẫn giữ nguyên đoạn chat. Nếu họ nhắn tiếp, đoạn chat sẽ hiện lại nhưng chỉ có tin mới.",
            deleteConversationFailed: "Không xoá được đoạn chat. Vui lòng thử lại.",
            conversationDeleted: "Đã xoá đoạn chat.",
            cancel: "Huỷ",
            confirmDelete: "Xoá",
            safetyWarningMsg: "CardVerseHub phát hiện nội dung có thể đưa giao dịch ra ngoài nền tảng. Để tránh scam, hãy trao đổi và thanh toán trực tiếp trên CardVerseHub.",
            payNow: "Thanh toán ngay",
            loadingMessages: "Đang tải tin nhắn...",
            title: "Tin nhắn CardVerseHub",
            loadOlderMessages: "Tải tin nhắn cũ hơn",
            you: "Bạn",
            cardVerseUser: "Người dùng CardVerseHub",
            offerTag: "Đề nghị giá",
            messagePlaceholder: "Nhập tin nhắn... Không chia sẻ Zalo/Facebook/số điện thoại hoặc thanh toán ngoài.",
            safetyBanner: "Cảnh báo an toàn: Để tránh lừa đảo, chỉ giao dịch và thanh toán trực tiếp trên CardVerseHub. Hãy đặc biệt cẩn trọng nếu ai đó yêu cầu chuyển sang Facebook, Zalo hoặc chuyển khoản ngân hàng bên ngoài.",
            muteConversation: "Tắt thông báo đoạn chat",
            unmuteConversation: "Bật thông báo đoạn chat",
            muteUpdateFailed: "Không thể cập nhật thông báo đoạn chat",
            imageButton: "Gửi ảnh",
            emojiButton: "Biểu tượng cảm xúc",
            uploadingImage: "Đang tải ảnh...",
            imageTooLarge: "Ảnh quá lớn (tối đa 8MB).",
            invalidImage: "Tệp không phải ảnh hợp lệ.",
            imageBlockedDescription: "Ảnh chứa số điện thoại bị chặn. Vui lòng giữ giao dịch trên CardVerseHub.",
            imageAlt: "Hình ảnh đính kèm",
            copyMessage: "Sao chép tin nhắn",
            messageCopied: "Đã sao chép",
            copyFailed: "Không thể sao chép tin nhắn. Hãy thử lại.",
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
                blockedMessageDescription: "詐欺防止のため、やり取りと支払いは必ずCardVerseHub内で行ってください。",
                sendMessageFailed: "メッセージを送信できません",
                safetyAlertTitle: "安全に関する警告",
                safetyAlertDescription: "メッセージに外部取引を促すキーワードが含まれています。支払いはCardVerseHub内に留めてください。",
                sendMessageError: "送信エラー",
                newCount: "件の新着",
                loginRequired: "メッセージを見るにはログインしてください。",
                inboxTitle: "受信トレイ",
                inboxSubtitle: "購入者・販売者とのやり取りを管理します",
                backToInbox: "受信トレイに戻る",
                safetyTips: "安全のヒント",
                moreActions: "その他の操作",
                sendMessage: "メッセージを送信",
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
                offerExpired: "終了 — 取引は成立しませんでした",
                acceptOffer: "オファーを承認",
                declineOffer: "拒否",
                declineOfferFailed: "オファーを拒否できません",
                offerMessageLabel: "メッセージ",
                offerPriceLabel: "提案価格",
                offerRejectedMsg: "{price} のオファーは拒否されました。購入者はより高い金額で再提案できます。",
                offerAcceptedMsg: "{price} のオファーが承認されました。チェックアウトでCardVerseHub上の支払いを完了してください。",
                offerAcceptedMsgSeller: "{price} のオファーを承認しました。購入者の支払いをお待ちください。",
                offerAcceptedToast: "オファーを承認しました",
                offerAcceptedToastDesc: "購入者に支払いの通知が送られます。",
                goCheckout: "チェックアウトへ",
                orderPaidMsg: "{price} を支払いました。出荷をお待ちください。",
                orderPaidMsgSeller: "購入者が {price} を支払いました。発送の準備をしてください。",
                viewOrder: "注文を見る",
                imagePreview: "📷 画像",
                messageRecalled: "メッセージの送信を取り消しました",
                recallMessage: "送信を取り消す",
                confirmRecallTitle: "このメッセージの送信を取り消しますか？",
                confirmRecallBody: "メッセージは双方から消え、「送信を取り消しました」とだけ表示されます。元に戻せません。",
                recallFailed: "送信を取り消せませんでした。もう一度お試しください。",
                conversationActions: "チャットの操作",
                deleteConversation: "チャットを削除",
                confirmDeleteConvTitle: "このチャットを削除しますか？",
                confirmDeleteConvBody: "削除されるのはあなたの側だけで、相手のチャットはそのまま残ります。相手が新しいメッセージを送ると、チャットは新しいメッセージだけを含んで再表示されます。",
                deleteConversationFailed: "チャットを削除できませんでした。もう一度お試しください。",
                conversationDeleted: "チャットを削除しました。",
                cancel: "キャンセル",
                confirmDelete: "削除",
                safetyWarningMsg: "取引を外部に移す可能性のある内容を検出しました。詐欺防止のため、やり取りと支払いはCardVerseHub上で行ってください。",
                payNow: "今すぐ支払う",
                loadingMessages: "メッセージを読み込み中...",
                title: "CardVerseHubメッセージ",
                loadOlderMessages: "以前のメッセージを読み込む",
                you: "あなた",
                cardVerseUser: "CardVerseHubユーザー",
                offerTag: "価格オファー",
                messagePlaceholder: "メッセージを入力... Zalo/Facebook/電話番号や外部決済情報は共有しないでください。",
                safetyBanner: "安全に関する警告: 詐欺防止のため、取引と支払いは必ずCardVerseHub上で行ってください。Facebook、Zalo、または外部銀行送金へ誘導された場合は特に注意してください。",
                muteConversation: "このチャットの通知をオフにする",
                unmuteConversation: "このチャットの通知をオンにする",
                muteUpdateFailed: "チャット通知を更新できません",
                imageButton: "画像を送信",
                emojiButton: "絵文字",
                uploadingImage: "画像をアップロード中...",
                imageTooLarge: "画像が大きすぎます（最大8MB）。",
                invalidImage: "有効な画像ファイルではありません。",
                imageBlockedDescription: "画像に電話番号が含まれています。取引はCardVerseHub内で行ってください。",
                imageAlt: "添付画像",
                copyMessage: "メッセージをコピー",
                messageCopied: "コピーしました",
                copyFailed: "メッセージをコピーできませんでした。もう一度お試しください。",
            }
            : {
                acceptOfferFailed: "Unable to accept offer",
                pleaseRetry: "Please try again.",
                error: "Error",
                chatError: "Chat error",
                loadConversationsFailed: "Unable to load conversations",
                loadMessagesFailed: "Unable to load messages",
                blockedMessageTitle: "Links or phone numbers cannot be sent",
                blockedMessageDescription: "Please keep communication and payment on CardVerseHub to avoid scams.",
                sendMessageFailed: "Unable to send message",
                safetyAlertTitle: "Safety warning",
                safetyAlertDescription: "This message contains terms that may move the deal off-platform. Keep payment on CardVerseHub.",
                sendMessageError: "Send error",
                newCount: "new",
                loginRequired: "Please log in to view messages.",
                inboxTitle: "Inbox",
                inboxSubtitle: "Manage conversations with buyers and sellers",
                backToInbox: "Back to inbox",
                safetyTips: "Safety tips",
                moreActions: "More actions",
                sendMessage: "Send message",
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
                offerExpired: "Closed — the order did not complete",
                acceptOffer: "Accept offer",
                declineOffer: "Decline",
                declineOfferFailed: "Unable to decline offer",
                offerMessageLabel: "Message",
                offerPriceLabel: "Offer price",
                offerRejectedMsg: "The {price} offer was declined. The buyer can send a new, higher offer.",
                offerAcceptedMsg: "The {price} offer was accepted. Go to checkout to pay directly on CardVerseHub.",
                offerAcceptedMsgSeller: "You accepted the {price} offer. Waiting for the buyer to check out.",
                offerAcceptedToast: "Offer accepted",
                offerAcceptedToastDesc: "The buyer will be notified to pay.",
                goCheckout: "Go to checkout",
                orderPaidMsg: "You paid {price}. Waiting for the seller to ship.",
                orderPaidMsgSeller: "The buyer paid {price}. Please prepare the shipment.",
                viewOrder: "View order",
                imagePreview: "📷 Photo",
                messageRecalled: "Message unsent",
                recallMessage: "Unsend message",
                confirmRecallTitle: "Unsend this message?",
                confirmRecallBody: "It disappears for both of you, leaving only \"Message unsent\" in its place. This cannot be undone.",
                recallFailed: "Could not unsend the message. Please try again.",
                conversationActions: "Chat options",
                deleteConversation: "Delete chat",
                confirmDeleteConvTitle: "Delete this chat?",
                confirmDeleteConvBody: "It is removed on your side only — the other person keeps theirs. If they write again, the chat comes back carrying just the new messages.",
                deleteConversationFailed: "Could not delete the chat. Please try again.",
                conversationDeleted: "Chat deleted.",
                cancel: "Cancel",
                confirmDelete: "Delete",
                safetyWarningMsg: "CardVerseHub detected content that may move the deal off-platform. Keep communication and payment on CardVerseHub to avoid scams.",
                payNow: "Pay now",
                loadingMessages: "Loading messages...",
                title: "CardVerseHub Messages",
                loadOlderMessages: "Load older messages",
                you: "You",
                cardVerseUser: "CardVerseHub user",
                offerTag: "Price offer",
                messagePlaceholder: "Type a message... Do not share Zalo/Facebook/phone numbers or arrange off-platform payment.",
                safetyBanner: "Safety Warning: To protect yourself from scams, only conduct transactions and payments directly on CardVerseHub. Be highly cautious if asked to move the conversation to Facebook, Zalo, or direct external bank transfers.",
                muteConversation: "Mute this conversation",
                unmuteConversation: "Unmute this conversation",
                muteUpdateFailed: "Unable to update conversation notifications",
                imageButton: "Send image",
                emojiButton: "Emoji",
                uploadingImage: "Uploading image...",
                imageTooLarge: "Image is too large (max 8MB).",
                invalidImage: "Not a valid image file.",
                imageBlockedDescription: "The image contains a blocked phone number. Please keep the deal on CardVerseHub.",
                imageAlt: "Attached image",
                copyMessage: "Copy message",
                messageCopied: "Copied",
                copyFailed: "Unable to copy the message. Please try again.",
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
    // Which bubble is currently showing its "copied" tick.
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    // Both confirmations are single pieces of state holding an id, not a dialog
    // per row: one AlertDialog lives at the end of the tree and reads whichever
    // is set.
    const [pendingRecallId, setPendingRecallId] = useState<string | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showEmoji, setShowEmoji] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [isSafetyExpanded, setIsSafetyExpanded] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const mobileTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const desktopTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [isUpdatingMute, setIsUpdatingMute] = useState(false);
    const [offer, setOffer] = useState<OfferSummary | null>(null);
    const [isAcceptingOffer, setIsAcceptingOffer] = useState(false);
    const offerActionKeys = useRef<Record<string, string>>({});
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

    const copyMessageText = useCallback(async (messageId: string, text: string) => {
        if (!text) return;
        const copied = await writeToClipboard(text);
        if (!copied) {
            toast({ variant: "destructive", title: copy.error, description: copy.copyFailed });
            return;
        }
        setCopiedMessageId(messageId);
        if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
        copiedResetRef.current = setTimeout(() => setCopiedMessageId(null), 1600);
    }, [toast, copy.error, copy.copyFailed]);

    useEffect(() => () => {
        if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    }, []);

    const resizeComposer = useCallback((element: HTMLTextAreaElement | null) => {
        if (!element) return;
        element.style.height = "44px";
        const styles = window.getComputedStyle(element);
        const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
        const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
        const maxHeight = (lineHeight * 5) + verticalPadding;

        // An empty textarea reports a single line of scrollHeight, so the
        // multi-line safety placeholder gets cut off until the user types. Size
        // the empty box to the placeholder instead, by borrowing the element for
        // one synchronous measurement — the value is restored before React or
        // the browser can paint it, so nothing flickers.
        // Never touch the value mid-IME: on a Japanese or Vietnamese composition
        // the pending text is not in `value` yet, and writing to it drops it.
        const measuringPlaceholder = element.value.length === 0
            && element.placeholder.length > 0
            && !isComposingRef.current;
        if (measuringPlaceholder) element.value = element.placeholder;
        const contentHeight = element.scrollHeight;
        if (measuringPlaceholder) element.value = "";

        element.style.height = `${Math.min(contentHeight, maxHeight)}px`;
        element.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    }, []);

    // Callback refs so the box is sized the moment it mounts, not one render
    // later — otherwise the drawer opens with a clipped placeholder.
    const attachMobileComposer = useCallback((node: HTMLTextAreaElement | null) => {
        mobileTextareaRef.current = node;
        resizeComposer(node);
    }, [resizeComposer]);

    const attachDesktopComposer = useCallback((node: HTMLTextAreaElement | null) => {
        desktopTextareaRef.current = node;
        resizeComposer(node);
    }, [resizeComposer]);

    // The placeholder wraps differently at different widths, and changes
    // entirely when the language does.
    useEffect(() => {
        const resizeBoth = () => {
            resizeComposer(mobileTextareaRef.current);
            resizeComposer(desktopTextareaRef.current);
        };
        resizeBoth();
        window.addEventListener("resize", resizeBoth);
        return () => window.removeEventListener("resize", resizeBoth);
    }, [resizeComposer, draft, copy.messagePlaceholder]);

    const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bottomRef.current?.scrollIntoView({ behavior, block: "end" });
            });
        });
    }, []);

    const selectedConversation = useMemo(
        () => conversations.find(conversation => conversation.id === selectedId) || null,
        [conversations, selectedId],
    );
    const isSellerInSelectedConversation =
        !!user && !!selectedConversation && (
            selectedConversation.sellerId === user.id ||
            selectedConversation.card?.seller_id === user.id
        );
    /**
     * The inbox line for a conversation, in the reader's language.
     *
     * `last_message_preview` is frozen at write time in whatever language the
     * producing route was written in — Vietnamese from the offer routes, English
     * from accept/reject — so a Japanese user reads a Vietnamese inbox next to a
     * correctly translated thread. The structured facts travel on the message's
     * `metadata`, the same source the open thread already renders from, so the
     * line can simply be rebuilt here.
     *
     * Falls back to the stored string for anything a person actually typed, and
     * for rows written before `kind` existed.
     */
    // A plain function, not useCallback: `copy` is a conditional object literal
    // rebuilt on every render, so memoising on it would never hit anyway.
    const conversationPreview = (conversation: ConversationItem) => {
        // Before anything else: the stored preview is a copy of the text that was
        // just taken back, so it is the one string in here that must never be
        // printed.
        if (conversation.lastMessageDeleted) return copy.messageRecalled;

        const meta = (conversation.lastMessageMetadata || {}) as { kind?: string; price?: number };
        // Role per row, not from the open conversation — this is a list.
        const viewerIsSeller = !!user && conversation.sellerId === user.id;

        if (typeof meta.price === "number") {
            if (meta.kind === "order_paid") {
                return (viewerIsSeller ? copy.orderPaidMsgSeller : copy.orderPaidMsg)
                    .replace("{price}", formatVND(meta.price));
            }
            if (meta.kind === "offer_accepted") {
                return (viewerIsSeller ? copy.offerAcceptedMsgSeller : copy.offerAcceptedMsg)
                    .replace("{price}", formatVND(meta.price));
            }
            if (meta.kind === "offer_rejected") {
                return copy.offerRejectedMsg.replace("{price}", formatVND(meta.price));
            }
        }
        if (conversation.lastMessageType === "safety_warning") return copy.safetyWarningMsg;
        if (conversation.lastMessageType === "image") {
            const caption = conversation.lastMessagePreview?.trim();
            // `LEGACY_IMAGE_PREVIEW` is what rows written before this stored; new
            // ones store an empty preview and let this label supply the words.
            if (!caption || caption === LEGACY_IMAGE_PREVIEW) return copy.imagePreview;
            return caption;
        }
        return conversation.lastMessagePreview || copy.startConversation;
    };

    /**
     * Offers whose payment already landed, from the thread itself.
     *
     * The "Go to checkout" button lives on the older offer_accepted bubble, which
     * knows nothing about what happened afterwards. Reading the payment back out
     * of the message list keeps the button honest with no extra fetch, and it
     * corrects itself the moment the order_paid message arrives over realtime.
     */
    const paidOfferIds = useMemo(() => new Set(
        messages
            .filter(message => (message.metadata as { kind?: string } | null)?.kind === "order_paid")
            .map(message => (message.metadata as { offerId?: string } | null)?.offerId)
            .filter((offerId): offerId is string => !!offerId),
    ), [messages]);

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
            const fingerprint = `${offer.id}:accept`;
            offerActionKeys.current[fingerprint] ||= crypto.randomUUID();
            const response = await fetch(`/api/offers/${offer.id}/accept`, {
                method: "POST",
                headers: { "Idempotency-Key": offerActionKeys.current[fingerprint] },
            });
            const payload = await response.json();
            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.acceptOfferFailed,
                    description: payload.error || copy.pleaseRetry,
                });
                return;
            }
            delete offerActionKeys.current[fingerprint];
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
            const fingerprint = `${offer.id}:reject`;
            offerActionKeys.current[fingerprint] ||= crypto.randomUUID();
            const response = await fetch(`/api/offers/${offer.id}/reject`, {
                method: "POST",
                headers: { "Idempotency-Key": offerActionKeys.current[fingerprint] },
            });
            const payload = await response.json();
            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.declineOfferFailed,
                    description: payload.error || copy.pleaseRetry,
                });
                return;
            }
            delete offerActionKeys.current[fingerprint];
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
            if (!selectedId && payload.conversations?.[0] && window.matchMedia("(min-width: 768px)").matches) {
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
            // An unsend arrives as an UPDATE, not an INSERT. Without this the
            // other party keeps reading a message that no longer exists until
            // they switch conversations. The row is merged rather than replaced
            // so a payload missing a column cannot blank one locally, and the
            // inbox is refreshed because the preview line may have been the
            // recalled text.
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
                (payload) => {
                    const updated = payload.new as ChatMessage;
                    setMessages(prev => prev.map(message => message.id === updated.id
                        ? { ...message, ...updated }
                        : message));
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
        requestAnimationFrame(() => resizeComposer(mobileTextareaRef.current));

        const restoreDraft = () => {
            if (selectedIdRef.current !== conversationId) return;
            const currentDraft = draftRef.current;
            const restoredDraft = currentDraft.trim() ? `${body}\n${currentDraft}` : body;
            draftRef.current = restoredDraft;
            setDraft(restoredDraft);
            requestAnimationFrame(() => resizeComposer(mobileTextareaRef.current));
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

    const recallMessage = async (messageId: string) => {
        try {
            const response = await fetch("/api/chat/messages", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || copy.recallFailed);
            }
            // Realtime delivers the same change a moment later; applying it here
            // as well means the sender's own bubble does not sit there looking
            // un-recalled while the round trip finishes. The UPDATE handler
            // merges by id, so arriving twice changes nothing.
            setMessages(prev => prev.map(message => message.id === messageId
                ? { ...message, body: "", metadata: {}, flagged_terms: [], deleted_at: new Date().toISOString() }
                : message));
            setPendingRecallId(null);
            void fetchConversations();
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.recallFailed;
            toast({ variant: "destructive", title: copy.recallFailed, description });
        }
    };

    const deleteConversation = async (conversationId: string) => {
        try {
            const response = await fetch("/api/chat/conversations", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || copy.deleteConversationFailed);
            }
            setConversations(prev => prev.filter(conversation => conversation.id !== conversationId));
            if (selectedIdRef.current === conversationId) setSelectedId(null);
            setPendingDeleteId(null);
            // The header badge counts conversations of its own, from its own
            // query. Tell it one just left the inbox.
            window.dispatchEvent(new Event("cardverse:chat-updated"));
            toast({ title: copy.conversationDeleted });
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.deleteConversationFailed;
            toast({ variant: "destructive", title: copy.deleteConversationFailed, description });
        }
    };

    const insertEmoji = (emoji: string) => {
        const next = `${draftRef.current}${emoji}`;
        draftRef.current = next;
        setDraft(next);
        requestAnimationFrame(() => {
            resizeComposer(mobileTextareaRef.current);
            mobileTextareaRef.current?.focus();
        });
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
        <>
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex h-[100dvh] w-full flex-col gap-0 p-0 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center md:h-full md:[&>button]:h-auto md:[&>button]:w-auto sm:max-w-5xl"
            >
                    <SheetHeader className={`${selectedConversation ? "hidden md:flex" : "flex"} border-b px-5 py-4`}>
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
                        <aside className={`min-h-0 border-r ${selectedConversation ? "hidden md:block" : "block"}`}>
                            <div className="border-b p-4">
                                <p className="text-sm font-semibold">{copy.inboxTitle}</p>
                                <p className="text-xs text-muted-foreground">{copy.inboxSubtitle}</p>
                            </div>
                            {/*
                              * Radix wraps a ScrollArea's content in a
                              * `display: table` div, which sizes itself to the
                              * longest line rather than to the column. This list
                              * was 725px wide inside a 339px column: `truncate`
                              * never fired, previews were cut off mid-word with
                              * no ellipsis, and anything positioned against the
                              * row's right edge sat 350px outside the visible
                              * area. Forcing that wrapper back to a block puts
                              * the rows back inside their column.
                              */}
                            <ScrollArea className="h-[calc(100dvh-132px)] md:h-[calc(100vh-132px)] [&>[data-radix-scroll-area-viewport]>div]:!block">
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
                                        // A row, not a button: the ⋯ menu is a
                                        // button of its own and cannot be nested
                                        // inside one. The row's own button still
                                        // covers the whole strip.
                                        <div
                                            key={conversation.id}
                                            className={`group relative flex border-b transition hover:bg-muted/50 ${selectedId === conversation.id ? "bg-orange-500/10" : ""}`}
                                        >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsSafetyExpanded(false);
                                                setShowMobileActions(false);
                                                setShowEmoji(false);
                                                setSelectedId(conversation.id);
                                            }}
                                            className="flex w-full gap-3 p-4 pr-10 text-left"
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
                                                    <p className="flex min-w-0 items-center gap-1 text-sm font-semibold">
                                                        <span className="truncate">
                                                            {conversation.otherUser?.display_name || conversation.otherUser?.email || "CardVerseHub user"}
                                                        </span>
                                                        <VerifiedSellerBadge verified={conversation.otherUser?.seller_verified} className="h-3.5 w-3.5" />
                                                    </p>
                                                    <div className="flex items-center gap-1.5">
                                                        {conversation.muted && <BellOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                        {conversation.unread && <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />}
                                                    </div>
                                                </div>
                                                <p className="truncate text-xs text-muted-foreground">{conversation.card?.name || copy.marketplaceChat}</p>
                                                <p className="mt-1 truncate text-xs">{conversationPreview(conversation)}</p>
                                                {conversation.lastMessageAt && (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true, locale: dateLocale })}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    aria-label={copy.conversationActions}
                                                    title={copy.conversationActions}
                                                    // Visible at rest, not on hover.
                                                    // Deleting a conversation is
                                                    // the only thing this list
                                                    // offers besides opening one;
                                                    // hiding it until the pointer
                                                    // happens to land there makes
                                                    // it undiscoverable, and on a
                                                    // phone there is no hover at all.
                                                    className="absolute right-1 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-60 transition hover:bg-foreground/10 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-foreground/10 data-[state=open]:opacity-100"
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    className="text-red-500 focus:text-red-500"
                                                    onClick={() => setPendingDeleteId(conversation.id)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    {copy.deleteConversation}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        </div>
                                    ))
                                )}
                            </ScrollArea>
                        </aside>

                        <section className={`${selectedConversation ? "flex" : "hidden md:flex"} min-h-0 flex-col`}>
                            {!selectedConversation ? (
                                <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                                    {copy.selectConversation}
                                </div>
                            ) : (
                                <>
                                    <div className="shrink-0 border-b p-2 pr-16 md:p-4">
                                        <div className="flex min-h-[48px] items-center gap-2 md:min-h-0 md:gap-3">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setIsSafetyExpanded(false);
                                                    setShowMobileActions(false);
                                                    setShowEmoji(false);
                                                    setSelectedId(null);
                                                }}
                                                aria-label={copy.backToInbox}
                                                title={copy.backToInbox}
                                                className="h-11 w-11 shrink-0 md:hidden"
                                            >
                                                <ArrowLeft className="h-5 w-5" />
                                            </Button>
                                            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted md:h-12 md:w-12">
                                                {selectedConversation.card?.image_url ? (
                                                    <Image src={optimizeCloudinaryUrl(selectedConversation.card.image_url, 160)} alt="" fill className="object-cover" />
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold">{selectedConversation.card?.name || copy.marketplaceChat}</p>
                                                <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                                                    <span className="truncate">
                                                        {copy.withUser} {selectedConversation.otherUser?.display_name || selectedConversation.otherUser?.email || copy.cardVerseUser}
                                                    </span>
                                                    <VerifiedSellerBadge verified={selectedConversation.otherUser?.seller_verified} className="h-3.5 w-3.5" />
                                                    {selectedConversation.card?.price ? <span className="shrink-0">{` · ${formatVND(selectedConversation.card.price)}`}</span> : null}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleToggleMute}
                                                loading={isUpdatingMute}
                                                disabled={isUpdatingMute}
                                                aria-label={selectedConversation.muted ? copy.unmuteConversation : copy.muteConversation}
                                                title={selectedConversation.muted ? copy.unmuteConversation : copy.muteConversation}
                                                className="h-11 w-11 shrink-0 md:h-10 md:w-10"
                                            >
                                                {isUpdatingMute ? null : selectedConversation.muted ? (
                                                    <BellOff className="h-4 w-4" />
                                                ) : (
                                                    <Bell className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                        <button
                                            type="button"
                                            aria-expanded={isSafetyExpanded}
                                            onClick={() => setIsSafetyExpanded(current => !current)}
                                            className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-left text-xs font-medium text-amber-100 md:hidden"
                                        >
                                            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                                            <span className="flex-1">{copy.safetyTips}</span>
                                            <ChevronDown className={`h-4 w-4 transition-transform ${isSafetyExpanded ? "rotate-180" : ""}`} />
                                        </button>
                                        {isSafetyExpanded && (
                                            <div className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100 md:hidden">
                                                <span className="mr-1" aria-hidden="true">⚠️</span>
                                                {copy.safetyBanner}
                                            </div>
                                        )}

                                        <div className="mt-3 hidden rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100 md:block">
                                            <div className="flex gap-2">
                                                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                <span>{copy.safetyBanner}</span>
                                            </div>
                                        </div>

                                        {offer && (
                                            <div className="mt-3 hidden rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 md:block">
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
                                                            {offer.status === "expired" && copy.offerExpired}
                                                        </p>
                                                    </div>

                                                    {isSellerInSelectedConversation && offer.status === "pending" && (
                                                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                                                            <Button
                                                                type="button"
                                                                onClick={handleAcceptOffer}
                                                                loading={isAcceptingOffer}
                                                                disabled={isAcceptingOffer || isRejectingOffer}
                                                                className="bg-orange-500 text-white hover:bg-orange-600"
                                                            >
                                                                {isAcceptingOffer ? null : (
                                                                    <CheckCircle className="mr-1.5 h-4 w-4" />
                                                                )}
                                                                {copy.acceptOffer}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                onClick={handleRejectOffer}
                                                                loading={isRejectingOffer}
                                                                disabled={isAcceptingOffer || isRejectingOffer}
                                                                className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                                                            >
                                                                {isRejectingOffer ? null : (
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

                                    {offer && (
                                        <div className="shrink-0 border-b border-orange-500/30 bg-background p-2 md:hidden">
                                            <div className="flex min-h-[56px] items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-base font-bold text-orange-400">{formatVND(offer.price)}</p>
                                                    <p className="truncate text-[11px] text-muted-foreground">
                                                        {offer.status === "pending" && copy.offerPending}
                                                        {offer.status === "chosen" && copy.offerChosen}
                                                        {offer.status === "accepted" && copy.offerAccepted}
                                                        {offer.status === "rejected" && copy.offerRejected}
                                                    </p>
                                                </div>

                                                {isSellerInSelectedConversation && offer.status === "pending" && (
                                                    <div className="flex shrink-0 gap-1.5">
                                                        <Button
                                                            type="button"
                                                            onClick={handleAcceptOffer}
                                                            loading={isAcceptingOffer}
                                                            disabled={isAcceptingOffer || isRejectingOffer}
                                                            className="h-11 bg-orange-500 px-3 text-white hover:bg-orange-600"
                                                        >
                                                            {isAcceptingOffer ? null : <CheckCircle className="h-4 w-4" />}
                                                            <span className="sr-only">{copy.acceptOffer}</span>
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            onClick={handleRejectOffer}
                                                            loading={isRejectingOffer}
                                                            disabled={isAcceptingOffer || isRejectingOffer}
                                                            className="h-11 border-rose-500/50 px-3 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                                                        >
                                                            {isRejectingOffer ? null : <X className="h-4 w-4" />}
                                                            <span className="sr-only">{copy.declineOffer}</span>
                                                        </Button>
                                                    </div>
                                                )}

                                                {offer.buyer_id === user.id && offer.status === "chosen" && (
                                                    <Button
                                                        type="button"
                                                        onClick={() => router.push(`/checkout?offerId=${offer.id}`)}
                                                        className="h-11 shrink-0 bg-orange-500 px-3 text-white hover:bg-orange-600"
                                                    >
                                                        <CreditCard className="mr-1.5 h-4 w-4" />
                                                        {copy.payNow}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}

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
                                                    // Ahead of every other branch, because a recalled row keeps its
                                                    // original `message_type` and would otherwise be rendered as the
                                                    // thing it used to be — an empty image bubble, most visibly. The
                                                    // row stays in place rather than vanishing so the other side can
                                                    // see that something was withdrawn instead of watching the
                                                    // conversation silently reshuffle.
                                                    if (message.deleted_at) {
                                                        return (
                                                            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                                <div className="max-w-[78%] rounded-2xl border border-dashed px-3 py-2 text-xs italic text-muted-foreground">
                                                                    {copy.messageRecalled}
                                                                    <span className="ml-2 not-italic opacity-70">
                                                                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
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
                                                        const meta = (message.metadata || {}) as { kind?: string; price?: number; checkoutUrl?: string; offerId?: string; orderId?: string };
                                                        // Role-aware wording. Do NOT reach for `mine` here: it means "the
                                                        // viewer sent this", and the sender differs per kind — the SELLER
                                                        // sends offer_accepted, the BUYER sends order_paid. Reading the role
                                                        // off the conversation instead keeps the two from being mirrored.
                                                        const systemBody = meta.kind === "offer_rejected" && typeof meta.price === "number"
                                                            ? copy.offerRejectedMsg.replace("{price}", formatVND(meta.price))
                                                            : meta.kind === "offer_accepted" && typeof meta.price === "number"
                                                                ? (mine ? copy.offerAcceptedMsgSeller : copy.offerAcceptedMsg).replace("{price}", formatVND(meta.price))
                                                                : meta.kind === "order_paid" && typeof meta.price === "number"
                                                                    ? (isSellerInSelectedConversation ? copy.orderPaidMsgSeller : copy.orderPaidMsg).replace("{price}", formatVND(meta.price))
                                                                    : message.body;
                                                        // Checkout is the BUYER's action only, and only while the offer is
                                                        // still unpaid — otherwise the stale button walks them back into the
                                                        // checkout for an order they already settled.
                                                        const showCheckout = meta.kind === "offer_accepted"
                                                            && !mine
                                                            && typeof meta.checkoutUrl === "string"
                                                            && !(meta.offerId && paidOfferIds.has(meta.offerId));
                                                        // Both sides follow the order from here on.
                                                        const showViewOrder = meta.kind === "order_paid" && typeof meta.orderId === "string";
                                                        return (
                                                            <div key={message.id} className="mx-auto max-w-xl rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-[13px] leading-relaxed text-orange-100 md:text-xs">
                                                                <p className="break-words">{systemBody}</p>
                                                                {showCheckout && (
                                                                    <Button
                                                                        size="sm"
                                                                        // Shown on every width. This used to collapse to
                                                                        // `hidden md:inline-flex` while the sticky offer bar was
                                                                        // up, to avoid two pay buttons on a phone — but desktop
                                                                        // has always shown both, and on mobile it left the
                                                                        // sentence "go to checkout to pay" sitting above nothing
                                                                        // to press. A duplicated CTA beats a dead instruction.
                                                                        className="mt-2 inline-flex h-11 w-full text-sm bg-orange-500 text-white hover:bg-orange-600 md:h-8"
                                                                        onClick={() => router.push(meta.checkoutUrl as string)}
                                                                    >
                                                                        {copy.goCheckout}
                                                                    </Button>
                                                                )}
                                                                {showViewOrder && (
                                                                    <Button
                                                                        size="sm"
                                                                        className="mt-2 inline-flex h-11 w-full text-sm bg-orange-500 text-white hover:bg-orange-600 md:h-8"
                                                                        onClick={() => router.push(`/orders/${meta.orderId}`)}
                                                                    >
                                                                        {copy.viewOrder}
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
                                                                <div className={`group max-w-[78%] overflow-hidden rounded-2xl ${mine ? "bg-orange-500 text-white" : "bg-muted"}`}>
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
                                                                    {message.body && <p className="whitespace-pre-wrap break-words px-3 pt-2 text-sm leading-6">{message.body}</p>}
                                                                    <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                                                                        <p className={`text-[10px] ${mine ? "text-white/75" : "text-muted-foreground"}`}>
                                                                            {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                        </p>
                                                                        {message.body && (
                                                                            <CopyMessageButton
                                                                                text={message.body}
                                                                                copied={copiedMessageId === message.id}
                                                                                onCopy={text => void copyMessageText(message.id, text)}
                                                                                onLight={mine}
                                                                                label={copy.copyMessage}
                                                                                copiedLabel={copy.messageCopied}
                                                                            />
                                                                        )}
                                                                        {mine && (
                                                                            <MessageActionsButton
                                                                                onLight={mine}
                                                                                label={copy.recallMessage}
                                                                                recallLabel={copy.recallMessage}
                                                                                onRecall={() => setPendingRecallId(message.id)}
                                                                            />
                                                                        )}
                                                                    </div>
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
                                                                <div className="group max-w-[86%] overflow-hidden rounded-2xl border border-orange-500/30 bg-orange-500/10 md:max-w-[78%]">
                                                                    <div className="flex items-center gap-1.5 border-b border-orange-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-orange-300 md:px-3">
                                                                        <HandCoins className="h-3.5 w-3.5" />
                                                                        {senderLabel} · {copy.offerTag}
                                                                    </div>
                                                                    <div className="px-2.5 py-2 md:px-3">
                                                                        {offerPrice !== null ? (
                                                                            <>
                                                                                <p className="hidden text-[10px] uppercase tracking-wide text-muted-foreground md:block">{copy.offerPriceLabel}</p>
                                                                                <p className="text-base font-bold text-orange-400 md:text-lg">{formatVND(offerPrice)}</p>
                                                                            </>
                                                                        ) : (
                                                                            <p className="text-sm text-orange-100">{message.body}</p>
                                                                        )}
                                                                        {offerCardName && <p className="mt-0.5 hidden text-xs text-muted-foreground md:block">{offerCardName}</p>}
                                                                        {offerText && (
                                                                            <div className="mt-2 rounded-md bg-background/40 px-2.5 py-1.5">
                                                                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{copy.offerMessageLabel}</p>
                                                                                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{offerText}</p>
                                                                            </div>
                                                                        )}
                                                                        <div className="mt-1.5 flex items-center gap-2">
                                                                            <p className="text-[10px] text-muted-foreground">
                                                                                {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                            </p>
                                                                            {(offerText || message.body) && (
                                                                                <CopyMessageButton
                                                                                    text={offerText || message.body}
                                                                                    copied={copiedMessageId === message.id}
                                                                                    onCopy={text => void copyMessageText(message.id, text)}
                                                                                    label={copy.copyMessage}
                                                                                    copiedLabel={copy.messageCopied}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                                                            <div className={`group max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-6 ${
                                                                mine
                                                                    ? "bg-orange-500 text-white"
                                                                    : "bg-muted"
                                                            }`}>
                                                                <p className={`mb-1 text-[11px] font-semibold ${mine ? "text-white/80" : "text-muted-foreground"}`}>
                                                                    {senderLabel}{offerAuto ? ` · ${copy.offerTag}` : ""}
                                                                </p>
                                                                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                                                                <div className="mt-1 flex items-center gap-2">
                                                                    <p className={`text-[10px] ${mine ? "text-white/75" : "text-muted-foreground"}`}>
                                                                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true, locale: dateLocale })}
                                                                    </p>
                                                                    {message.body && (
                                                                        <CopyMessageButton
                                                                            text={message.body}
                                                                            copied={copiedMessageId === message.id}
                                                                            onCopy={text => void copyMessageText(message.id, text)}
                                                                            onLight={mine}
                                                                            label={copy.copyMessage}
                                                                            copiedLabel={copy.messageCopied}
                                                                        />
                                                                    )}
                                                                    {mine && !offerAuto && (
                                                                        <MessageActionsButton
                                                                            onLight={mine}
                                                                            label={copy.recallMessage}
                                                                            recallLabel={copy.recallMessage}
                                                                            onRecall={() => setPendingRecallId(message.id)}
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div ref={bottomRef} />
                                            </div>
                                        )}
                                    </ScrollArea>

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

                                    <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
                                        {showEmoji && (
                                            <div className="mb-2 grid max-h-40 grid-cols-7 gap-1 overflow-y-auto rounded-lg border bg-background p-2">
                                                {CHAT_EMOJIS.map(emoji => (
                                                    <button
                                                        key={emoji}
                                                        type="button"
                                                        className="min-h-11 min-w-11 rounded text-lg transition-colors hover:bg-muted"
                                                        onClick={() => insertEmoji(emoji)}
                                                    >
                                                        {emoji}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="relative flex items-end gap-2">
                                            {showMobileActions && (
                                                <div className="absolute bottom-full left-0 z-30 mb-2 flex gap-1 rounded-lg border bg-background p-1.5 shadow-lg">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copy.emojiButton}
                                                        onClick={() => {
                                                            setShowEmoji(current => !current);
                                                            setShowMobileActions(false);
                                                        }}
                                                        className="h-11 w-11"
                                                    >
                                                        <Smile className="h-5 w-5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copy.imageButton}
                                                        onClick={() => {
                                                            setShowMobileActions(false);
                                                            fileInputRef.current?.click();
                                                        }}
                                                        disabled={isUploadingImage}
                                                        className="h-11 w-11"
                                                    >
                                                        {isUploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                                                    </Button>
                                                </div>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={copy.moreActions}
                                                aria-expanded={showMobileActions}
                                                onClick={() => {
                                                    setShowMobileActions(current => !current);
                                                    setShowEmoji(false);
                                                }}
                                                className="h-11 w-11 shrink-0"
                                            >
                                                <Plus className={`h-5 w-5 transition-transform ${showMobileActions ? "rotate-45" : ""}`} />
                                            </Button>
                                            <Textarea
                                                ref={attachMobileComposer}
                                                rows={1}
                                                value={draft}
                                                onFocus={() => {
                                                    scrollChatToBottom("auto");
                                                    window.setTimeout(() => scrollChatToBottom("auto"), 250);
                                                }}
                                                onChange={event => {
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                    resizeComposer(event.currentTarget);
                                                }}
                                                onCompositionStart={() => {
                                                    isComposingRef.current = true;
                                                }}
                                                onCompositionEnd={event => {
                                                    isComposingRef.current = false;
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                    resizeComposer(event.currentTarget);
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
                                                className="min-h-11 max-h-[132px] resize-none overflow-y-hidden py-2.5"
                                                maxLength={2000}
                                            />
                                            <Button
                                                type="button"
                                                onClick={sendMessage}
                                                loading={isSending}
                                                disabled={!draft.trim() || isSending}
                                                aria-label={copy.sendMessage}
                                                className="h-11 w-11 shrink-0 bg-orange-500 px-0 text-white hover:bg-orange-600"
                                            >
                                                {isSending ? null : <Send className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="hidden border-t p-4 md:block">
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
                                                ref={attachDesktopComposer}
                                                rows={1}
                                                value={draft}
                                                onChange={event => {
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                    resizeComposer(event.currentTarget);
                                                }}
                                                onCompositionStart={() => {
                                                    isComposingRef.current = true;
                                                }}
                                                onCompositionEnd={event => {
                                                    isComposingRef.current = false;
                                                    draftRef.current = event.currentTarget.value;
                                                    setDraft(event.currentTarget.value);
                                                    resizeComposer(event.currentTarget);
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
                                                className="min-h-11 max-h-[132px] resize-none overflow-y-hidden"
                                                maxLength={2000}
                                            />
                                            <Button
                                                type="button"
                                                onClick={sendMessage}
                                                loading={isSending}
                                                disabled={!draft.trim() || isSending}
                                                className="h-11 bg-orange-500 text-white hover:bg-orange-600"
                                            >
                                                {isSending ? null : <Send className="h-4 w-4" />}
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

        {/* Both confirmations sit outside the Sheet: two nested Radix layers
          * fight over the focus trap, and a dialog rendered inside the row it
          * is asking about disappears the moment that row does. */}
        <AlertDialog open={!!pendingRecallId} onOpenChange={open => !open && setPendingRecallId(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{copy.confirmRecallTitle}</AlertDialogTitle>
                    <AlertDialogDescription>{copy.confirmRecallBody}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-500 text-white hover:bg-red-600"
                        onClick={event => {
                            // Keep the dialog up while the request is in flight,
                            // the way the cart's remove confirmation does.
                            event.preventDefault();
                            if (pendingRecallId) void recallMessage(pendingRecallId);
                        }}
                    >
                        {copy.recallMessage}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!pendingDeleteId} onOpenChange={open => !open && setPendingDeleteId(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{copy.confirmDeleteConvTitle}</AlertDialogTitle>
                    <AlertDialogDescription>{copy.confirmDeleteConvBody}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-500 text-white hover:bg-red-600"
                        onClick={event => {
                            event.preventDefault();
                            if (pendingDeleteId) void deleteConversation(pendingDeleteId);
                        }}
                    >
                        {copy.confirmDelete}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}
