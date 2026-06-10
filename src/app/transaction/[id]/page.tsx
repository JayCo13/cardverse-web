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

const formatVND = (amount: number) => new Intl.NumberFormat("vi-VN").format(amount) + "đ";
const INSURANCE_CAP = 2000000;

export default function TransactionRoomPage() {
    const params = useParams();
    const router = useRouter();
    const transactionId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { toast } = useToast();

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
                setTimeRemaining("Hết hạn");
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
            setFeeError("Không thể tính phí ship. Vui lòng thử lại.");
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
                toast({ variant: "destructive", title: "Không thể thanh toán", description: data.error });
                return;
            }
            if (!res.ok) throw new Error(data.error);

            if (data.payment_method === "direct_payos" && data.checkoutUrl) {
                window.open(data.checkoutUrl, "_blank");
                toast({ title: "Đang chuyển hướng...", description: "Vui lòng hoàn tất thanh toán trên trang PayOS." });
            } else {
                toast({ title: "🎉 Thanh toán thành công!", description: "Tiền đang được CardVerse giữ. Theo dõi đơn tại trang Đơn hàng." });
                router.push("/orders");
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "Lỗi", description: err.message || "Không thể thanh toán." });
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
                title: "Giao dịch đã hủy",
                message: `Giao dịch cho thẻ "${card.name}" đã bị hủy. Lý do: ${cancelReason}`,
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
                <h1 className="text-2xl font-bold mb-4">Giao dịch không tồn tại</h1>
                <Button onClick={() => router.push("/buy")}>Quay lại</Button>
            </div>
        );
    }

    // Completed
    if (transaction.status === "completed") {
        return (
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-green-500 mb-2">Thanh toán hoàn tất!</h1>
                    <p className="text-muted-foreground mb-4">
                        Tiền đang được CardVerse giữ an toàn. Người bán sẽ giao hàng, bạn theo dõi đơn tại trang Đơn hàng.
                    </p>
                    {card && (
                        <div className="bg-card rounded-lg p-4 mb-6 inline-block">
                            <p className="font-medium">{card.name}</p>
                            <p className="text-2xl font-bold text-primary">{formatVND(transaction.price)}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push("/orders")}>Xem đơn hàng</Button>
                        <Button variant="outline" onClick={() => router.push("/buy")}>Tiếp tục mua sắm</Button>
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
                        {isAutoCancelled ? "Giao dịch đã hết hạn" : "Giao dịch đã hủy"}
                    </h1>
                    <p className="text-muted-foreground mb-4">
                        {isAutoCancelled
                            ? "Giao dịch đã tự động hủy do quá thời hạn 2 giờ."
                            : `Giao dịch đã bị hủy bởi ${transaction.cancelledBy === "seller" ? "người bán" : "người mua"}.`}
                    </p>
                    {transaction.cancellationReason && (
                        <div className="bg-card rounded-lg p-4 mb-6 text-left">
                            <p className="text-sm text-muted-foreground">Lý do hủy:</p>
                            <p className="font-medium">{transaction.cancellationReason}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push(`/cards/${transaction.cardId}`)}>Xem thẻ</Button>
                        <Button variant="outline" onClick={() => router.push("/buy")}>Tiếp tục mua sắm</Button>
                    </div>
                </div>
            </div>
        );
    }

    if (!isSeller && !isBuyer) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <h1 className="text-2xl font-bold mb-4">Bạn không có quyền truy cập giao dịch này</h1>
                <Button onClick={() => router.push("/buy")}>Quay lại</Button>
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
                        <h1 className="text-2xl font-bold mb-2">Phòng Giao Dịch</h1>
                        <p className="text-muted-foreground">{isSeller ? "Bạn là người bán" : "Bạn là người mua"}</p>
                    </div>
                    <div className="text-right">
                        <div className="flex items-center gap-2 text-orange-500">
                            <Clock className="h-5 w-5" />
                            <span className="font-mono text-xl font-bold">{timeRemaining}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Thời gian còn lại</p>
                    </div>
                </div>
            </div>

            {/* Escrow safety banner */}
            <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
                    <div className="text-sm">
                        <p className="font-semibold text-orange-300">Giao dịch an toàn — CardVerse giữ tiền</p>
                        <p className="text-muted-foreground">
                            Buyer thanh toán trực tiếp trên CardVerse, tiền được giữ và chỉ chuyển cho người bán sau khi
                            giao hàng thành công. Tuyệt đối không chuyển khoản ngoài nền tảng để tránh bị lừa.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Card info */}
                <CardUI>
                    <CardHeader>
                        <CardTitle>Thông tin thẻ</CardTitle>
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
                                    <p className="text-sm text-muted-foreground mt-2">Giá đã chốt</p>
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
                                <Truck className="h-5 w-5" /> Địa chỉ nhận hàng
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
                                    ⚠️ Người bán chưa cập nhật địa chỉ gửi hàng. Phí ship có thể tính sau.
                                </div>
                            )}
                        </CardContent>
                    </CardUI>
                ) : (
                    <CardUI>
                        <CardHeader>
                            <CardTitle>Trạng thái</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center gap-2 text-orange-400">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="font-medium">Đang chờ người mua thanh toán</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Người mua đang hoàn tất thanh toán trên CardVerse. Khi xong, đơn hàng sẽ xuất hiện ở trang
                                Đơn hàng để bạn chuẩn bị giao hàng. Bạn không cần liên hệ riêng với người mua.
                            </p>
                            {buyerProfile && (
                                <p className="text-sm">
                                    <span className="text-muted-foreground">Người mua: </span>
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
                            <ShieldCheck className="h-5 w-5 text-orange-500" /> Thanh toán an toàn
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Payment breakdown */}
                        <div className="rounded-xl border border-orange-500/20 bg-gradient-to-b from-accent/40 to-orange-500/5 p-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Tiền thẻ (đã chốt)</span>
                                <span className="font-semibold">{formatVND(agreedPrice)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Truck className="h-4 w-4 text-blue-400" />
                                    <span>Tiền ship (GHN)</span>
                                </div>
                                <div>
                                    {loadingFee ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    ) : shippingFee !== null ? (
                                        <span className="font-semibold">{formatVND(shippingFee)}</span>
                                    ) : feeError ? (
                                        <span className="text-xs text-red-400">{feeError}</span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">Chọn địa chỉ để tính</span>
                                    )}
                                </div>
                            </div>
                            <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                                <span className="font-semibold">Tổng thanh toán</span>
                                <span className="text-2xl font-bold text-orange-400">
                                    {shippingFee !== null ? formatVND(totalAmount) : "--"}
                                </span>
                            </div>
                        </div>

                        {/* Payment method */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">Phương thức thanh toán</Label>
                            <RadioGroup
                                value={paymentMethod}
                                onValueChange={(v) => setPaymentMethod(v as "wallet" | "direct_payos")}
                                className="space-y-2"
                            >
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === "wallet" ? "border-orange-500 bg-orange-500/5" : "hover:bg-accent/50"}`}>
                                    <RadioGroupItem value="wallet" id="wallet" />
                                    <Wallet className="h-5 w-5 text-orange-500" />
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">Ví Cardverse</p>
                                        <p className={`text-xs ${insufficientBalance ? "text-red-400" : "text-green-400"}`}>
                                            Số dư: {isLoadingWallet ? "..." : formatVND(walletBalance)}
                                            {insufficientBalance && !isLoadingWallet && " (Không đủ)"}
                                        </p>
                                    </div>
                                </label>
                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === "direct_payos" ? "border-orange-500 bg-orange-500/5" : "hover:bg-accent/50"}`}>
                                    <RadioGroupItem value="direct_payos" id="direct" />
                                    <CreditCard className="h-5 w-5 text-blue-500" />
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">Chuyển khoản / QR (PayOS)</p>
                                        <p className="text-xs text-muted-foreground">
                                            Thanh toán trực tiếp qua ngân hàng • Tổng: {shippingFee !== null ? formatVND(totalAmount) : "--"}
                                        </p>
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>

                        {paymentMethod === "wallet" && insufficientBalance && !isLoadingWallet && shippingFee !== null && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                                Số dư ví không đủ. Bạn cần thêm {formatVND(totalAmount - walletBalance)}.
                                <Button variant="link" size="sm" className="text-orange-400 p-0 h-auto ml-1" asChild>
                                    <a href="/wallet" target="_blank">Nạp tiền ngay <ExternalLink className="h-3 w-3 ml-1" /></a>
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
                                {shippingFee !== null ? `Thanh toán ${formatVND(totalAmount)}` : "Chọn địa chỉ trước"}
                            </Button>
                            <Button variant="destructive" onClick={() => setShowCancelDialog(true)} className="gap-2">
                                <XCircle className="h-5 w-5" /> Hủy giao dịch
                            </Button>
                        </div>
                    </CardContent>
                </CardUI>
            )}

            {/* Seller cancel action */}
            {isSeller && (
                <div className="mt-6 flex justify-center">
                    <Button variant="destructive" className="gap-2" onClick={() => setShowCancelDialog(true)}>
                        <XCircle className="h-5 w-5" /> Hủy giao dịch
                    </Button>
                </div>
            )}

            {/* Auto-cancel note */}
            <div className="mt-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-yellow-500">Lưu ý quan trọng</p>
                        <p className="text-muted-foreground">
                            Giao dịch sẽ tự động hủy sau 2 giờ nếu người mua chưa thanh toán. Mọi trao đổi và thanh toán
                            hãy thực hiện trực tiếp trên CardVerse để được bảo vệ.
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
                            Hủy giao dịch
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {isBuyer && (
                                <span className="text-destructive font-medium block mb-2">
                                    Cảnh báo: Việc hủy giao dịch sẽ ảnh hưởng đến điểm uy tín của bạn!
                                </span>
                            )}
                            Vui lòng nhập lý do hủy giao dịch (tối thiểu 10 ký tự).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <Label htmlFor="cancel-reason">Lý do hủy</Label>
                        <Textarea
                            id="cancel-reason"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Nhập lý do hủy giao dịch..."
                            className="mt-2"
                            rows={3}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Quay lại</AlertDialogCancel>
                        <Button
                            variant="destructive"
                            onClick={() => handleCancel(isSeller ? "seller" : "buyer")}
                            disabled={isProcessing || cancelReason.trim().length < 10}
                        >
                            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Xác nhận hủy
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
