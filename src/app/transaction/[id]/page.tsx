"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Transaction, Card, UserProfile } from "@/lib/types";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AddressBook, type SavedAddress } from "@/components/address-book";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Clock, CheckCircle, XCircle, AlertTriangle, Loader2, ShieldCheck,
    Truck, Wallet, CreditCard, ExternalLink,
} from "lucide-react";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { useLocalization } from "@/context/localization-context";

const formatVND = (amount: number) => new Intl.NumberFormat("vi-VN").format(amount) + "đ";
const INSURANCE_CAP = 2000000;

export default function TransactionRoomPage() {
    const params = useParams();
    const router = useRouter();
    const transactionId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { toast } = useToast();
    const { locale } = useLocalization();
    const copy = locale === "vi-VN"
        ? {
            expired: "Hết hạn",
            feeError: "Không thể tính phí ship. Vui lòng thử lại.",
            cannotPay: "Không thể thanh toán",
            redirecting: "Đang chuyển hướng...",
            completePayOnPayos: "Vui lòng hoàn tất thanh toán trên trang PayOS.",
            paymentSuccess: "🎉 Thanh toán thành công!",
            paymentSuccessDesc: "Tiền đang được CardVerse giữ. Theo dõi đơn tại trang Đơn hàng.",
            error: "Lỗi",
            cannotPayDesc: "Không thể thanh toán.",
            txCancelled: "Giao dịch đã hủy",
            txCancelledMsg: 'Giao dịch cho thẻ "{name}" đã bị hủy. Lý do: {reason}',
            notFound: "Giao dịch không tồn tại",
            back: "Quay lại",
            completedTitle: "Thanh toán hoàn tất!",
            completedDesc: "Tiền đang được CardVerse giữ an toàn. Người bán sẽ giao hàng, bạn theo dõi đơn tại trang Đơn hàng.",
            viewOrders: "Xem đơn hàng",
            continueShopping: "Tiếp tục mua sắm",
            expiredTitle: "Giao dịch đã hết hạn",
            cancelledTitle: "Giao dịch đã hủy",
            expiredDesc: "Giao dịch đã tự động hủy do quá thời hạn 2 giờ.",
            cancelledBy: "Giao dịch đã bị hủy bởi {role}.",
            seller: "người bán",
            buyer: "người mua",
            cancelReason: "Lý do hủy:",
            viewCard: "Xem thẻ",
            noAccess: "Bạn không có quyền truy cập giao dịch này",
            roomTitle: "Phòng Giao Dịch",
            youAreSeller: "Bạn là người bán",
            youAreBuyer: "Bạn là người mua",
            timeRemaining: "Thời gian còn lại",
            safeTxTitle: "Giao dịch an toàn — CardVerse giữ tiền",
            safeTxDesc: "Buyer thanh toán trực tiếp trên CardVerse, tiền được giữ và chỉ chuyển cho người bán sau khi giao hàng thành công. Tuyệt đối không chuyển khoản ngoài nền tảng để tránh bị lừa.",
            cardInfo: "Thông tin thẻ",
            agreedPrice: "Giá đã chốt",
            shippingAddress: "Địa chỉ nhận hàng",
            missingSellerAddress: "⚠️ Người bán chưa cập nhật địa chỉ gửi hàng. Phí ship có thể tính sau.",
            status: "Trạng thái",
            waitingBuyerPayment: "Đang chờ người mua thanh toán",
            waitingBuyerDesc: "Người mua đang hoàn tất thanh toán trên CardVerse. Khi xong, đơn hàng sẽ xuất hiện ở trang Đơn hàng để bạn chuẩn bị giao hàng. Bạn không cần liên hệ riêng với người mua.",
            buyerLabel: "Người mua:",
            securePayment: "Thanh toán an toàn",
            cardAmount: "Tiền thẻ (đã chốt)",
            shippingFee: "Tiền ship (GHN)",
            chooseAddressToCalc: "Chọn địa chỉ để tính",
            totalPayment: "Tổng thanh toán",
            paymentMethod: "Phương thức thanh toán",
            wallet: "Ví Cardverse",
            balance: "Số dư",
            insufficientShort: "Không đủ",
            bankQr: "Chuyển khoản / QR (PayOS)",
            bankQrDesc: "Thanh toán trực tiếp qua ngân hàng • Tổng: {amount}",
            walletInsufficient: "Số dư ví không đủ. Bạn cần thêm {amount}.",
            topUpNow: "Nạp tiền ngay",
            payAction: "Thanh toán {amount}",
            chooseAddressFirst: "Chọn địa chỉ trước",
            cancelTransaction: "Hủy giao dịch",
            importantNote: "Lưu ý quan trọng",
            importantDesc: "Giao dịch sẽ tự động hủy sau 2 giờ nếu người mua chưa thanh toán. Mọi trao đổi và thanh toán hãy thực hiện trực tiếp trên CardVerse để được bảo vệ.",
            cancelDialogTitle: "Hủy giao dịch",
            cancelWarning: "Cảnh báo: Việc hủy giao dịch sẽ ảnh hưởng đến điểm uy tín của bạn!",
            cancelPrompt: "Vui lòng nhập lý do hủy giao dịch (tối thiểu 10 ký tự).",
            cancelReasonLabel: "Lý do hủy",
            cancelReasonPlaceholder: "Nhập lý do hủy giao dịch...",
            goBack: "Quay lại",
            confirmCancel: "Xác nhận hủy",
        }
        : locale === "ja-JP"
            ? {
                expired: "期限切れ",
                feeError: "送料を計算できません。もう一度お試しください。",
                cannotPay: "支払いできません",
                redirecting: "リダイレクト中...",
                completePayOnPayos: "PayOSページで支払いを完了してください。",
                paymentSuccess: "🎉 支払い完了！",
                paymentSuccessDesc: "代金はCardVerseが安全に保持します。注文ページで進捗を確認してください。",
                error: "エラー",
                cannotPayDesc: "支払いできません。",
                txCancelled: "取引はキャンセルされました",
                txCancelledMsg: 'カード「{name}」の取引がキャンセルされました。理由: {reason}',
                notFound: "取引が見つかりません",
                back: "戻る",
                completedTitle: "支払いが完了しました！",
                completedDesc: "代金はCardVerseが安全に保持します。販売者が発送し、注文ページで追跡できます。",
                viewOrders: "注文を見る",
                continueShopping: "買い物を続ける",
                expiredTitle: "取引は期限切れです",
                cancelledTitle: "取引はキャンセルされました",
                expiredDesc: "2時間の制限を超えたため自動キャンセルされました。",
                cancelledBy: "{role}によって取引がキャンセルされました。",
                seller: "販売者",
                buyer: "購入者",
                cancelReason: "キャンセル理由:",
                viewCard: "カードを見る",
                noAccess: "この取引にアクセスする権限がありません",
                roomTitle: "取引ルーム",
                youAreSeller: "あなたは販売者です",
                youAreBuyer: "あなたは購入者です",
                timeRemaining: "残り時間",
                safeTxTitle: "安全な取引 — CardVerseが代金を保持",
                safeTxDesc: "購入者はCardVerse上で直接支払い、商品到着まで代金は保留されます。詐欺防止のため、外部送金はしないでください。",
                cardInfo: "カード情報",
                agreedPrice: "確定価格",
                shippingAddress: "配送先住所",
                missingSellerAddress: "⚠️ 販売者が発送元住所をまだ更新していません。送料は後で計算される場合があります。",
                status: "ステータス",
                waitingBuyerPayment: "購入者の支払い待ち",
                waitingBuyerDesc: "購入者がCardVerseで支払いを完了中です。完了すると注文ページに表示され、発送準備ができます。購入者へ個別連絡は不要です。",
                buyerLabel: "購入者:",
                securePayment: "安全な支払い",
                cardAmount: "カード代金（確定）",
                shippingFee: "送料 (GHN)",
                chooseAddressToCalc: "住所を選択して計算",
                totalPayment: "合計支払い",
                paymentMethod: "支払い方法",
                wallet: "CardVerseウォレット",
                balance: "残高",
                insufficientShort: "不足",
                bankQr: "銀行振込 / QR (PayOS)",
                bankQrDesc: "銀行から直接支払い • 合計: {amount}",
                walletInsufficient: "ウォレット残高が不足しています。あと {amount} 必要です。",
                topUpNow: "今すぐチャージ",
                payAction: "{amount} を支払う",
                chooseAddressFirst: "先に住所を選択",
                cancelTransaction: "取引をキャンセル",
                importantNote: "重要なお知らせ",
                importantDesc: "購入者が2時間以内に支払わない場合、取引は自動キャンセルされます。やり取りと支払いは必ずCardVerse上で行ってください。",
                cancelDialogTitle: "取引をキャンセル",
                cancelWarning: "警告: 取引をキャンセルすると信頼スコアに影響します。",
                cancelPrompt: "キャンセル理由を入力してください（10文字以上）。",
                cancelReasonLabel: "キャンセル理由",
                cancelReasonPlaceholder: "キャンセル理由を入力...",
                goBack: "戻る",
                confirmCancel: "キャンセルを確定",
            }
            : {
                expired: "Expired",
                feeError: "Unable to calculate shipping fee. Please try again.",
                cannotPay: "Unable to pay",
                redirecting: "Redirecting...",
                completePayOnPayos: "Please complete payment on the PayOS page.",
                paymentSuccess: "🎉 Payment successful!",
                paymentSuccessDesc: "CardVerse is holding the funds securely. Track the order on the Orders page.",
                error: "Error",
                cannotPayDesc: "Unable to pay.",
                txCancelled: "Transaction cancelled",
                txCancelledMsg: 'Transaction for card "{name}" was cancelled. Reason: {reason}',
                notFound: "Transaction not found",
                back: "Back",
                completedTitle: "Payment completed!",
                completedDesc: "CardVerse is holding the funds securely. The seller will ship the card, and you can track it on the Orders page.",
                viewOrders: "View orders",
                continueShopping: "Continue shopping",
                expiredTitle: "Transaction expired",
                cancelledTitle: "Transaction cancelled",
                expiredDesc: "The transaction was auto-cancelled after the 2-hour limit.",
                cancelledBy: "The transaction was cancelled by the {role}.",
                seller: "seller",
                buyer: "buyer",
                cancelReason: "Cancellation reason:",
                viewCard: "View card",
                noAccess: "You do not have access to this transaction",
                roomTitle: "Transaction Room",
                youAreSeller: "You are the seller",
                youAreBuyer: "You are the buyer",
                timeRemaining: "Time remaining",
                safeTxTitle: "Secure transaction — CardVerse holds the money",
                safeTxDesc: "The buyer pays directly on CardVerse, and funds are only released to the seller after successful delivery. Do not transfer money off-platform.",
                cardInfo: "Card information",
                agreedPrice: "Agreed price",
                shippingAddress: "Shipping address",
                missingSellerAddress: "⚠️ The seller has not added a pickup address yet. Shipping may be calculated later.",
                status: "Status",
                waitingBuyerPayment: "Waiting for buyer payment",
                waitingBuyerDesc: "The buyer is completing payment on CardVerse. Once done, the order will appear on the Orders page so you can prepare shipment. No direct contact is needed.",
                buyerLabel: "Buyer:",
                securePayment: "Secure payment",
                cardAmount: "Card amount (agreed)",
                shippingFee: "Shipping fee (GHN)",
                chooseAddressToCalc: "Choose an address to calculate",
                totalPayment: "Total payment",
                paymentMethod: "Payment method",
                wallet: "CardVerse wallet",
                balance: "Balance",
                insufficientShort: "Insufficient",
                bankQr: "Bank transfer / QR (PayOS)",
                bankQrDesc: "Pay directly via bank • Total: {amount}",
                walletInsufficient: "Wallet balance is insufficient. You need {amount} more.",
                topUpNow: "Top up now",
                payAction: "Pay {amount}",
                chooseAddressFirst: "Choose an address first",
                cancelTransaction: "Cancel transaction",
                importantNote: "Important note",
                importantDesc: "The transaction will auto-cancel after 2 hours if the buyer does not pay. Keep all communication and payment on CardVerse for protection.",
                cancelDialogTitle: "Cancel transaction",
                cancelWarning: "Warning: Cancelling this transaction will affect your trust score.",
                cancelPrompt: "Please enter a cancellation reason (minimum 10 characters).",
                cancelReasonLabel: "Cancellation reason",
                cancelReasonPlaceholder: "Enter cancellation reason...",
                goBack: "Go back",
                confirmCancel: "Confirm cancellation",
            };

    const [transaction, setTransaction] = useState<Transaction | null>(null);
    const [card, setCard] = useState<Card | null>(null);
    const [buyerProfile, setBuyerProfile] = useState<UserProfile | null>(null);
    const [sellerProfile, setSellerProfile] = useState<UserProfile | null>(null);
    const [sellerPickup, setSellerPickup] = useState<{ districtId: number; wardCode: string } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeRemaining, setTimeRemaining] = useState<string>("");

    // Cancel dialog
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);

    // Checkout state (buyer side)
    const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
    const [shippingFee, setShippingFee] = useState<number | null>(null);
    const [loadingFee, setLoadingFee] = useState(false);
    const [feeError, setFeeError] = useState("");
    const [paymentMethod, setPaymentMethod] = useState<"wallet" | "direct_payos">("wallet");
    const [walletBalance, setWalletBalance] = useState(0);
    const [isLoadingWallet, setIsLoadingWallet] = useState(true);
    const [isPaying, setIsPaying] = useState(false);

    const isSeller = user?.id === transaction?.sellerId;
    const isBuyer = user?.id === transaction?.buyerId;

    const mapTransaction = (data: any): Transaction => ({
        id: data.id,
        cardId: data.card_id,
        sellerId: data.seller_id,
        buyerId: data.buyer_id,
        offerId: data.offer_id,
        price: data.price,
        status: data.status,
        cancelledBy: data.cancelled_by,
        cancellationReason: data.cancellation_reason,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
        completedAt: data.completed_at,
        cancelledAt: data.cancelled_at,
    });

    const mapCard = (c: any): Card => ({
        id: c.id,
        name: c.name,
        imageUrl: c.image_url || "",
        imageUrls: c.image_urls,
        category: c.category,
        condition: c.condition,
        listingType: c.listing_type,
        price: c.price,
        currentBid: c.current_bid,
        sellerId: c.seller_id,
        author: c.seller_id,
        description: c.description,
        lastSoldPrice: c.last_sold_price,
        status: c.status,
    });

    const mapProfile = (p: any): UserProfile => ({
        uid: p.id,
        email: p.email,
        displayName: p.display_name || "",
        phoneNumber: p.phone_number || "",
        address: p.address || "",
        city: p.city || "",
        profileImageUrl: p.profile_image_url || "",
        emailVerified: true,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
    });

    // Initial fetch + realtime on the transaction row
    useEffect(() => {
        if (!transactionId) return;

        const fetchTransaction = async () => {
            const { data: txData } = await supabase
                .from("transactions")
                .select("*")
                .eq("id", transactionId)
                .single();

            if (txData) {
                const tx = mapTransaction(txData);
                setTransaction(tx);

                const { data: cardData } = await supabase
                    .from("cards")
                    .select("*")
                    .eq("id", tx.cardId)
                    .single();
                if (cardData) setCard(mapCard(cardData));

                const { data: buyerData } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", tx.buyerId)
                    .single();
                if (buyerData) setBuyerProfile(mapProfile(buyerData));

                const { data: sellerData } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", tx.sellerId)
                    .single();
                if (sellerData) {
                    setSellerProfile(mapProfile(sellerData));
                    if ((sellerData as any).address_district_id && (sellerData as any).address_ward_code) {
                        setSellerPickup({
                            districtId: (sellerData as any).address_district_id,
                            wardCode: (sellerData as any).address_ward_code,
                        });
                    }
                }
            }
            setIsLoading(false);
        };

        fetchTransaction();

        const channel = supabase
            .channel(`transaction-${transactionId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "transactions", filter: `id=eq.${transactionId}` },
                (payload) => {
                    if (payload.new) setTransaction(mapTransaction(payload.new));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [transactionId]); // supabase is a stable singleton

    // Wallet balance (buyer only)
    const fetchWallet = useCallback(async () => {
        setIsLoadingWallet(true);
        try {
            const res = await fetch("/api/wallet");
            const data = await res.json();
            setWalletBalance(data.wallet?.available_balance || 0);
        } catch {
            // ignore — shown as 0
        } finally {
            setIsLoadingWallet(false);
        }
    }, []);

    useEffect(() => {
        if (isBuyer) void fetchWallet();
    }, [isBuyer, fetchWallet]);

    // Countdown timer
    useEffect(() => {
        if (!transaction?.expiresAt) return;
        const interval = setInterval(() => {
            const diff = new Date(transaction.expiresAt).getTime() - Date.now();
            if (diff <= 0) {
                setTimeRemaining(copy.expired);
                clearInterval(interval);
            } else {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                setTimeRemaining(`${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [transaction?.expiresAt]);

    // GHN shipping fee for the picked address
    const calculateFee = useCallback(async (address: SavedAddress | null) => {
        setShippingFee(null);
        setFeeError("");
        if (!address || !sellerPickup || !card) return;

        setLoadingFee(true);
        try {
            const query = new URLSearchParams({
                from_district_id: sellerPickup.districtId.toString(),
                from_ward_code: sellerPickup.wardCode,
                to_district_id: address.district_id.toString(),
                to_ward_code: address.ward_code,
                insurance_value: Math.min(transaction?.price || 0, INSURANCE_CAP).toString(),
            });
            const res = await fetch(`/api/shipping/fee?${query}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setShippingFee(data.shipping_fee);
        } catch {
            setFeeError(copy.feeError);
        } finally {
            setLoadingFee(false);
        }
    }, [sellerPickup, card, transaction?.price]);

    const handleSelectAddress = useCallback((address: SavedAddress | null) => {
        setSelectedAddress(address);
        void calculateFee(address);
    }, [calculateFee]);

    // Recalculate once the seller pickup address arrives after a selection.
    useEffect(() => {
        if (sellerPickup && selectedAddress) void calculateFee(selectedAddress);
    }, [sellerPickup, selectedAddress, calculateFee]);

    const agreedPrice = transaction?.price || 0;
    const totalAmount = agreedPrice + (shippingFee || 0);
    const insufficientBalance = walletBalance < totalAmount;
    const canPay = !!selectedAddress && shippingFee !== null && !loadingFee && !isPaying;

    const handlePay = async () => {
        if (!transaction || !selectedAddress || !canPay) return;
        if (paymentMethod === "wallet" && insufficientBalance) return;

        setIsPaying(true);
        try {
            const res = await fetch(`/api/transaction/${transactionId}/pay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payment_method: paymentMethod,
                    shipping_fee: shippingFee,
                    to_name: selectedAddress.recipient_name,
                    to_phone: selectedAddress.phone,
                    to_district_id: selectedAddress.district_id,
                    to_district_name: selectedAddress.district_name,
                    to_province_id: selectedAddress.province_id,
                    to_province_name: selectedAddress.province_name,
                    to_ward_code: selectedAddress.ward_code,
                    to_ward_name: selectedAddress.ward_name,
                    to_address_detail: selectedAddress.detail,
                    shipping_address: `${selectedAddress.detail}, ${selectedAddress.ward_name}, ${selectedAddress.district_name}, ${selectedAddress.province_name}`,
                }),
            });
            const data = await res.json();

            if (res.status === 409 || data.code === "card_unavailable" || data.code === "transaction_expired" || data.code === "transaction_not_active") {
                toast({ variant: "destructive", title: copy.cannotPay, description: data.error });
                return;
            }
            if (!res.ok) throw new Error(data.error);

            if (data.payment_method === "direct_payos" && data.checkoutUrl) {
                window.open(data.checkoutUrl, "_blank");
                toast({ title: copy.redirecting, description: copy.completePayOnPayos });
            } else {
                toast({ title: copy.paymentSuccess, description: copy.paymentSuccessDesc });
                router.push("/orders");
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: copy.error, description: err.message || copy.cannotPayDesc });
        } finally {
            setIsPaying(false);
        }
    };

    // Cancel transaction (only possible while still active / pre-payment)
    const handleCancel = async (cancelledBy: "seller" | "buyer") => {
        if (!transaction || !card || cancelReason.trim().length < 10) return;
        setIsProcessing(true);
        try {
            await supabase
                .from("transactions")
                .update({
                    status: "cancelled",
                    cancelled_by: cancelledBy,
                    cancellation_reason: cancelReason,
                    cancelled_at: new Date().toISOString(),
                } as never)
                .eq("id", transactionId);

            await supabase
                .from("cards")
                .update({ status: "active", reserved_until: null } as never)
                .eq("id", transaction.cardId);

            await supabase.from("cancellations").insert({
                user_id: cancelledBy === "seller" ? transaction.sellerId : transaction.buyerId,
                transaction_id: transactionId,
                reason: cancelReason,
            } as never);

            if (cancelledBy === "buyer") await updateLegitRate(transaction.buyerId, false);

            const recipientId = cancelledBy === "seller" ? transaction.buyerId : transaction.sellerId;
            await supabase.from("notifications").insert({
                user_id: recipientId,
                type: "offer_rejected",
                title: copy.txCancelled,
                message: copy.txCancelledMsg.replace("{name}", card.name).replace("{reason}", cancelReason),
                card_id: transaction.cardId,
            } as never);

            setShowCancelDialog(false);
            router.push(`/cards/${transaction.cardId}`);
        } catch (error) {
            console.error("Error cancelling transaction:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    const updateLegitRate = async (userId: string, isCompleted: boolean) => {
        const today = new Date().toISOString().split("T")[0];
        const { data: profileData } = await supabase
            .from("profiles")
            .select("legit_rate, total_transactions, completed_transactions, cancelled_transactions, daily_cancellations, last_cancellation_date")
            .eq("id", userId)
            .single();

        if (profileData) {
            const p = profileData as any;
            const isNewDay = p.last_cancellation_date !== today;
            let newRate = p.legit_rate;
            let dailyCancellations = isNewDay ? 0 : p.daily_cancellations;

            if (isCompleted) {
                newRate = Math.min(100, newRate + 2);
            } else {
                dailyCancellations += 1;
                newRate = Math.max(0, newRate - 5);
                if (dailyCancellations > 3) newRate = Math.max(0, newRate - 10);
            }

            await supabase
                .from("profiles")
                .update({
                    legit_rate: newRate,
                    total_transactions: p.total_transactions + 1,
                    completed_transactions: isCompleted ? p.completed_transactions + 1 : p.completed_transactions,
                    cancelled_transactions: isCompleted ? p.cancelled_transactions : p.cancelled_transactions + 1,
                    daily_cancellations: dailyCancellations,
                    last_cancellation_date: isCompleted ? p.last_cancellation_date : today,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq("id", userId);
        }
    };

    if (isLoading) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Skeleton className="h-96 w-full rounded-2xl" />
            </div>
        );
    }

    if (!transaction) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <h1 className="text-2xl font-bold mb-4">{copy.notFound}</h1>
                <Button onClick={() => router.push("/buy")}>{copy.back}</Button>
            </div>
        );
    }

    // Completed
    if (transaction.status === "completed") {
        return (
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-green-500 mb-2">{copy.completedTitle}</h1>
                    <p className="text-muted-foreground mb-4">
                        {copy.completedDesc}
                    </p>
                    {card && (
                        <div className="bg-card rounded-lg p-4 mb-6 inline-block">
                            <p className="font-medium">{card.name}</p>
                            <p className="text-2xl font-bold text-primary">{formatVND(transaction.price)}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push("/orders")}>{copy.viewOrders}</Button>
                        <Button variant="outline" onClick={() => router.push("/buy")}>{copy.continueShopping}</Button>
                    </div>
                </div>
            </div>
        );
    }

    // Cancelled / expired
    if (transaction.status === "cancelled" || transaction.status === "auto_cancelled") {
        const isAutoCancelled = transaction.status === "auto_cancelled";
        return (
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center">
                    <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-red-500 mb-2">
                        {isAutoCancelled ? copy.expiredTitle : copy.cancelledTitle}
                    </h1>
                    <p className="text-muted-foreground mb-4">
                        {isAutoCancelled
                            ? copy.expiredDesc
                            : copy.cancelledBy.replace("{role}", transaction.cancelledBy === "seller" ? copy.seller : copy.buyer)}
                    </p>
                    {transaction.cancellationReason && (
                        <div className="bg-card rounded-lg p-4 mb-6 text-left">
                            <p className="text-sm text-muted-foreground">{copy.cancelReason}</p>
                            <p className="font-medium">{transaction.cancellationReason}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push(`/cards/${transaction.cardId}`)}>{copy.viewCard}</Button>
                        <Button variant="outline" onClick={() => router.push("/buy")}>{copy.continueShopping}</Button>
                    </div>
                </div>
            </div>
        );
    }

    if (!isSeller && !isBuyer) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <h1 className="text-2xl font-bold mb-4">{copy.noAccess}</h1>
                <Button onClick={() => router.push("/buy")}>{copy.back}</Button>
            </div>
        );
    }

    // ── Active transaction ──
    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            {/* Header with countdown */}
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-2xl p-6 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold mb-2">{copy.roomTitle}</h1>
                        <p className="text-muted-foreground">{isSeller ? copy.youAreSeller : copy.youAreBuyer}</p>
                    </div>
                    <div className="text-right">
                        <div className="flex items-center gap-2 text-orange-500">
                            <Clock className="h-5 w-5" />
                            <span className="font-mono text-xl font-bold">{timeRemaining}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{copy.timeRemaining}</p>
                    </div>
                </div>
            </div>

            {/* Escrow safety banner */}
            <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
                    <div className="text-sm">
                        <p className="font-semibold text-orange-300">{copy.safeTxTitle}</p>
                        <p className="text-muted-foreground">
                            {copy.safeTxDesc}
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Card info */}
                <CardUI>
                    <CardHeader>
                        <CardTitle>{copy.cardInfo}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {card && (
                            <div className="flex gap-4">
                                <div className="relative w-24 h-32 rounded-lg overflow-hidden shrink-0">
                                    <Image src={card.imageUrl || "/placeholder.png"} alt={card.name} fill className="object-cover" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">{card.name}</h3>
                                    <Badge variant="outline">{card.category}</Badge>
                                    <p className="text-sm text-muted-foreground mt-2">{copy.agreedPrice}</p>
                                    <p className="text-2xl font-bold text-primary">{formatVND(agreedPrice)}</p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </CardUI>

                {/* Right column: buyer checkout OR seller waiting state */}
                {isBuyer ? (
                    <CardUI>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Truck className="h-5 w-5" /> {copy.shippingAddress}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <AddressBook
                                selectable
                                selectedId={selectedAddress?.id ?? null}
                                onSelect={handleSelectAddress}
                            />
                            {!sellerPickup && (
                                <div className="mt-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                                    {copy.missingSellerAddress}
                                </div>
                            )}
                        </CardContent>
                    </CardUI>
                ) : (
                    <CardUI>
                        <CardHeader>
                            <CardTitle>{copy.status}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center gap-2 text-orange-400">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="font-medium">{copy.waitingBuyerPayment}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {copy.waitingBuyerDesc}
                            </p>
                            {buyerProfile && (
                                <p className="text-sm">
                                    <span className="text-muted-foreground">{copy.buyerLabel} </span>
                                    <span className="font-medium">{buyerProfile.displayName || buyerProfile.email}</span>
                                </p>
                            )}
                        </CardContent>
                    </CardUI>
                )}
            </div>

            {/* Buyer payment panel */}
            {isBuyer && (
                <CardUI className="mt-6">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-orange-500" /> {copy.securePayment}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Payment breakdown */}
                        <div className="rounded-xl border border-orange-500/20 bg-gradient-to-b from-accent/40 to-orange-500/5 p-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{copy.cardAmount}</span>
                                <span className="font-semibold">{formatVND(agreedPrice)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Truck className="h-4 w-4 text-blue-400" />
                                    <span>{copy.shippingFee}</span>
                                </div>
                                <div>
                                    {loadingFee ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    ) : shippingFee !== null ? (
                                        <span className="font-semibold">{formatVND(shippingFee)}</span>
                                    ) : feeError ? (
                                        <span className="text-xs text-red-400">{feeError}</span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">{copy.chooseAddressToCalc}</span>
                                    )}
                                </div>
                            </div>
                            <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                                <span className="font-semibold">{copy.totalPayment}</span>
                                <span className="text-2xl font-bold text-orange-400">
                                    {shippingFee !== null ? formatVND(totalAmount) : "--"}
                                </span>
                            </div>
                        </div>

                        {/* Payment method */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">{copy.paymentMethod}</Label>
                            <RadioGroup
                                value={paymentMethod}
                                onValueChange={(v) => setPaymentMethod(v as "wallet" | "direct_payos")}
                                className="space-y-2"
                            >
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === "wallet" ? "border-orange-500 bg-orange-500/5" : "hover:bg-accent/50"}`}>
                                    <RadioGroupItem value="wallet" id="wallet" />
                                    <Wallet className="h-5 w-5 text-orange-500" />
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">{copy.wallet}</p>
                                        <p className={`text-xs ${insufficientBalance ? "text-red-400" : "text-green-400"}`}>
                                            {copy.balance}: {isLoadingWallet ? "..." : formatVND(walletBalance)}
                                            {insufficientBalance && !isLoadingWallet && ` (${copy.insufficientShort})`}
                                        </p>
                                    </div>
                                </label>
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === "direct_payos" ? "border-orange-500 bg-orange-500/5" : "hover:bg-accent/50"}`}>
                                    <RadioGroupItem value="direct_payos" id="direct" />
                                    <CreditCard className="h-5 w-5 text-blue-500" />
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">{copy.bankQr}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {copy.bankQrDesc.replace("{amount}", shippingFee !== null ? formatVND(totalAmount) : "--")}
                                        </p>
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>

                        {paymentMethod === "wallet" && insufficientBalance && !isLoadingWallet && shippingFee !== null && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                                {copy.walletInsufficient.replace("{amount}", formatVND(totalAmount - walletBalance))}
                                <Button variant="link" size="sm" className="text-orange-400 p-0 h-auto ml-1" asChild>
                                    <a href="/wallet" target="_blank">{copy.topUpNow} <ExternalLink className="h-3 w-3 ml-1" /></a>
                                </Button>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                                onClick={handlePay}
                                disabled={!canPay || (paymentMethod === "wallet" && insufficientBalance)}
                                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold"
                            >
                                {isPaying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                                {shippingFee !== null ? copy.payAction.replace("{amount}", formatVND(totalAmount)) : copy.chooseAddressFirst}
                            </Button>
                            <Button variant="destructive" onClick={() => setShowCancelDialog(true)} className="gap-2">
                                <XCircle className="h-5 w-5" /> {copy.cancelTransaction}
                            </Button>
                        </div>
                    </CardContent>
                </CardUI>
            )}

            {/* Seller cancel action */}
            {isSeller && (
                <div className="mt-6 flex justify-center">
                    <Button variant="destructive" className="gap-2" onClick={() => setShowCancelDialog(true)}>
                        <XCircle className="h-5 w-5" /> {copy.cancelTransaction}
                    </Button>
                </div>
            )}

            {/* Auto-cancel note */}
            <div className="mt-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-yellow-500">{copy.importantNote}</p>
                        <p className="text-muted-foreground">
                            {copy.importantDesc}
                        </p>
                    </div>
                </div>
            </div>

            {/* Cancel Dialog */}
            <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            {copy.cancelDialogTitle}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {isBuyer && (
                                <span className="text-destructive font-medium block mb-2">
                                    {copy.cancelWarning}
                                </span>
                            )}
                            {copy.cancelPrompt}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <Label htmlFor="cancel-reason">{copy.cancelReasonLabel}</Label>
                        <Textarea
                            id="cancel-reason"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder={copy.cancelReasonPlaceholder}
                            className="mt-2"
                            rows={3}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>{copy.goBack}</AlertDialogCancel>
                        <Button
                            variant="destructive"
                            onClick={() => handleCancel(isSeller ? "seller" : "buyer")}
                            disabled={isProcessing || cancelReason.trim().length < 10}
                        >
                            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {copy.confirmCancel}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
