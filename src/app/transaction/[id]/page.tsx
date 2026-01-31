"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Transaction, Card, Offer, UserProfile } from "@/lib/types";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Package, Phone } from "lucide-react";
import Image from "next/image";
import { useCurrency } from "@/contexts/currency-context";

export default function TransactionRoomPage() {
    const params = useParams();
    const router = useRouter();
    const transactionId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();

    const [transaction, setTransaction] = useState<Transaction | null>(null);
    const [card, setCard] = useState<Card | null>(null);
    const [buyerProfile, setBuyerProfile] = useState<UserProfile | null>(null);
    const [sellerProfile, setSellerProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeRemaining, setTimeRemaining] = useState<string>("");

    // Dialog states
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [showCompleteDialog, setShowCompleteDialog] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);

    const isSeller = user?.id === transaction?.sellerId;
    const isBuyer = user?.id === transaction?.buyerId;

    // Use centralized currency formatting
    const { formatPrice } = useCurrency();

    // Helper function to map Supabase data to our types
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
        imageUrl: c.image_url || '',
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
        displayName: p.display_name || '',
        phoneNumber: p.phone_number || '',
        address: p.address || '',
        city: p.city || '',
        profileImageUrl: p.profile_image_url || '',
        emailVerified: true,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
    });

    // Listen to transaction updates
    useEffect(() => {
        if (!transactionId) return;

        // Initial fetch
        const fetchTransaction = async () => {
            const { data: txData } = await supabase
                .from('transactions')
                .select('*')
                .eq('id', transactionId)
                .single();

            if (txData) {
                const tx = mapTransaction(txData);
                setTransaction(tx);

                // Fetch card
                const { data: cardData } = await supabase
                    .from('cards')
                    .select('*')
                    .eq('id', tx.cardId)
                    .single();
                if (cardData) setCard(mapCard(cardData));

                // Fetch profiles
                const { data: buyerData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', tx.buyerId)
                    .single();
                if (buyerData) setBuyerProfile(mapProfile(buyerData));

                const { data: sellerData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', tx.sellerId)
                    .single();
                if (sellerData) setSellerProfile(mapProfile(sellerData));
            }
            setIsLoading(false);
        };

        fetchTransaction();

        // Subscribe to realtime updates
        const channel = supabase
            .channel(`transaction-${transactionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'transactions',
                    filter: `id=eq.${transactionId}`,
                },
                (payload) => {
                    if (payload.new) {
                        setTransaction(mapTransaction(payload.new));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [transactionId]); // supabase is stable singleton

    // Update countdown timer
    useEffect(() => {
        if (!transaction?.expiresAt) return;

        const interval = setInterval(() => {
            const now = new Date();
            const expires = new Date(transaction.expiresAt);
            const diff = expires.getTime() - now.getTime();

            if (diff <= 0) {
                setTimeRemaining("Hết hạn");
                clearInterval(interval);
            } else {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                setTimeRemaining(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [transaction?.expiresAt]);

    // Prevent navigation
    useEffect(() => {
        if (transaction?.status !== 'active') return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Bạn đang trong giao dịch. Bạn có chắc muốn rời đi?';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [transaction?.status]);

    // Mark as sold (seller only)
    const handleMarkAsSold = async () => {
        if (!transaction || !card) return;
        setIsProcessing(true);

        try {
            // Update transaction
            await supabase
                .from('transactions')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                })
                .eq('id', transactionId);

            // Update card
            await supabase
                .from('cards')
                .update({
                    status: 'sold',
                    last_sold_price: transaction.price,
                })
                .eq('id', transaction.cardId);

            // Update buyer legit rate (completed transaction)
            await updateLegitRate(transaction.buyerId, true);

            // Send notification to buyer
            await supabase.from('notifications').insert({
                user_id: transaction.buyerId,
                type: 'card_sold',
                title: 'Giao dịch hoàn tất!',
                message: `Giao dịch cho thẻ "${card.name}" đã hoàn tất thành công!`,
                card_id: transaction.cardId,
                read: false,
            });

            setShowCompleteDialog(false);
            router.push(`/cards/${transaction.cardId}`);
        } catch (error) {
            console.error("Error completing transaction:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    // Cancel transaction
    const handleCancel = async (cancelledBy: 'seller' | 'buyer') => {
        if (!transaction || !card || !cancelReason.trim()) return;
        setIsProcessing(true);

        try {
            // Update transaction
            await supabase
                .from('transactions')
                .update({
                    status: 'cancelled',
                    cancelled_by: cancelledBy,
                    cancellation_reason: cancelReason,
                    cancelled_at: new Date().toISOString(),
                })
                .eq('id', transactionId);

            // Update card back to active
            await supabase
                .from('cards')
                .update({ status: 'active' })
                .eq('id', transaction.cardId);

            // Create cancellation record
            await supabase.from('cancellations').insert({
                user_id: cancelledBy === 'seller' ? transaction.sellerId : transaction.buyerId,
                transaction_id: transactionId,
                reason: cancelReason,
            });

            // Update legit rate if buyer cancelled
            if (cancelledBy === 'buyer') {
                await updateLegitRate(transaction.buyerId, false);
            }

            // Send notification
            const recipientId = cancelledBy === 'seller' ? transaction.buyerId : transaction.sellerId;
            await supabase.from('notifications').insert({
                user_id: recipientId,
                type: 'offer_rejected',
                title: 'Giao dịch đã hủy',
                message: `Giao dịch cho thẻ "${card.name}" đã bị hủy. Lý do: ${cancelReason}`,
                card_id: transaction.cardId,
                read: false,
            });

            setShowCancelDialog(false);
            router.push(`/cards/${transaction.cardId}`);
        } catch (error) {
            console.error("Error cancelling transaction:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    // Update legit rate
    const updateLegitRate = async (userId: string, isCompleted: boolean) => {
        const today = new Date().toISOString().split('T')[0];

        // Get current profile data
        const { data: profileData } = await supabase
            .from('profiles')
            .select('legit_rate, total_transactions, completed_transactions, cancelled_transactions, daily_cancellations, last_cancellation_date')
            .eq('id', userId)
            .single();

        if (profileData) {
            const isNewDay = profileData.last_cancellation_date !== today;
            let newRate = profileData.legit_rate;
            let dailyCancellations = isNewDay ? 0 : profileData.daily_cancellations;

            if (isCompleted) {
                newRate = Math.min(100, newRate + 2);
            } else {
                dailyCancellations += 1;
                newRate = Math.max(0, newRate - 5);
                // Extra penalty for >3 cancellations/day
                if (dailyCancellations > 3) {
                    newRate = Math.max(0, newRate - 10);
                }
            }

            await supabase
                .from('profiles')
                .update({
                    legit_rate: newRate,
                    total_transactions: profileData.total_transactions + 1,
                    completed_transactions: isCompleted ? profileData.completed_transactions + 1 : profileData.completed_transactions,
                    cancelled_transactions: isCompleted ? profileData.cancelled_transactions : profileData.cancelled_transactions + 1,
                    daily_cancellations: dailyCancellations,
                    last_cancellation_date: isCompleted ? profileData.last_cancellation_date : today,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', userId);
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
                <Button onClick={() => router.push('/buy')}>Quay lại</Button>
            </div>
        );
    }

    // Show completed transaction status
    if (transaction.status === 'completed') {
        return (
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-green-500 mb-2">Giao dịch hoàn tất!</h1>
                    <p className="text-muted-foreground mb-4">
                        Giao dịch đã được hoàn tất thành công vào{' '}
                        {transaction.completedAt && new Date(transaction.completedAt).toLocaleString('vi-VN')}
                    </p>
                    {card && (
                        <div className="bg-card rounded-lg p-4 mb-6 inline-block">
                            <p className="font-medium">{card.name}</p>
                            <p className="text-2xl font-bold text-primary">{formatPrice(transaction.price)}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push(`/cards/${transaction.cardId}`)}>
                            Xem thẻ
                        </Button>
                        <Button variant="outline" onClick={() => router.push('/buy')}>
                            Tiếp tục mua sắm
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // Show cancelled transaction status
    if (transaction.status === 'cancelled' || transaction.status === 'auto_cancelled') {
        const isAutoCancelled = transaction.status === 'auto_cancelled';
        return (
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center">
                    <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-red-500 mb-2">
                        {isAutoCancelled ? 'Giao dịch đã hết hạn' : 'Giao dịch đã hủy'}
                    </h1>
                    <p className="text-muted-foreground mb-4">
                        {isAutoCancelled
                            ? 'Giao dịch đã tự động hủy do quá thời hạn 2 giờ.'
                            : `Giao dịch đã bị hủy bởi ${transaction.cancelledBy === 'seller' ? 'người bán' : 'người mua'}.`
                        }
                    </p>
                    {transaction.cancellationReason && (
                        <div className="bg-card rounded-lg p-4 mb-6 text-left">
                            <p className="text-sm text-muted-foreground">Lý do hủy:</p>
                            <p className="font-medium">{transaction.cancellationReason}</p>
                        </div>
                    )}
                    {card && (
                        <div className="bg-card rounded-lg p-4 mb-6 inline-block">
                            <p className="font-medium">{card.name}</p>
                            <p className="text-xl font-bold text-muted-foreground">{formatPrice(transaction.price)}</p>
                        </div>
                    )}
                    <div className="flex gap-4 justify-center">
                        <Button onClick={() => router.push(`/cards/${transaction.cardId}`)}>
                            Xem thẻ
                        </Button>
                        <Button variant="outline" onClick={() => router.push('/buy')}>
                            Tiếp tục mua sắm
                        </Button>
                    </div>
                </div>
            </div>
        );
    }


    if (!isSeller && !isBuyer) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <h1 className="text-2xl font-bold mb-4">Bạn không có quyền truy cập giao dịch này</h1>
                <Button onClick={() => router.push('/buy')}>Quay lại</Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            {/* Header with countdown */}
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-2xl p-6 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold mb-2">Phòng Giao Dịch</h1>
                        <p className="text-muted-foreground">
                            {isSeller ? "Bạn là người bán" : "Bạn là người mua"}
                        </p>
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

            <div className="grid md:grid-cols-2 gap-6">
                {/* Card info */}
                <CardUI>
                    <CardHeader>
                        <CardTitle>Thông tin thẻ</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {card && (
                            <div className="flex gap-4">
                                <div className="relative w-24 h-32 rounded-lg overflow-hidden">
                                    <Image
                                        src={card.imageUrl || "/placeholder.png"}
                                        alt={card.name}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">{card.name}</h3>
                                    <Badge variant="outline">{card.category}</Badge>
                                    <p className="text-2xl font-bold text-primary mt-2">
                                        {formatPrice(transaction.price)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </CardUI>

                {/* Contact info */}
                <CardUI>
                    <CardHeader>
                        <CardTitle>Thông tin liên hệ</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {isSeller && buyerProfile && (
                            <div>
                                <p className="text-sm text-muted-foreground">Người mua</p>
                                <p className="font-medium">{buyerProfile.displayName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <Phone className="h-4 w-4" />
                                    <span>{buyerProfile.phoneNumber}</span>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {buyerProfile.address}, {buyerProfile.city}
                                </p>
                            </div>
                        )}
                        {isBuyer && sellerProfile && (
                            <div>
                                <p className="text-sm text-muted-foreground">Người bán</p>
                                <p className="font-medium">{sellerProfile.displayName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <Phone className="h-4 w-4" />
                                    <span>{sellerProfile.phoneNumber}</span>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {sellerProfile.address}, {sellerProfile.city}
                                </p>
                            </div>
                        )}
                    </CardContent>
                </CardUI>
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex gap-4 justify-center">
                {isSeller && (
                    <>
                        <Button
                            size="lg"
                            className="gap-2"
                            onClick={() => setShowCompleteDialog(true)}
                        >
                            <CheckCircle className="h-5 w-5" />
                            Đánh dấu đã bán
                        </Button>
                        <Button
                            size="lg"
                            variant="destructive"
                            className="gap-2"
                            onClick={() => setShowCancelDialog(true)}
                        >
                            <XCircle className="h-5 w-5" />
                            Hủy giao dịch
                        </Button>
                    </>
                )}
                {isBuyer && (
                    <Button
                        size="lg"
                        variant="destructive"
                        className="gap-2"
                        onClick={() => setShowCancelDialog(true)}
                    >
                        <XCircle className="h-5 w-5" />
                        Hủy giao dịch
                    </Button>
                )}
            </div>

            {/* Warning banner */}
            <div className="mt-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-yellow-500">Lưu ý quan trọng</p>
                        <p className="text-muted-foreground">
                            Giao dịch sẽ tự động hủy sau 2 giờ nếu không có hành động.
                            Liên hệ với đối tác qua số điện thoại để hoàn tất giao dịch.
                        </p>
                    </div>
                </div>
            </div>

            {/* Complete Dialog */}
            <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Xác nhận giao dịch hoàn tất</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bạn xác nhận đã giao thẻ và nhận được tiền từ người mua?
                            Hành động này không thể hoàn tác.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Hủy</AlertDialogCancel>
                        <AlertDialogAction onClick={handleMarkAsSold} disabled={isProcessing}>
                            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Xác nhận
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
                            onClick={() => handleCancel(isSeller ? 'seller' : 'buyer')}
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
