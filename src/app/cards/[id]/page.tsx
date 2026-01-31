"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useLocalization } from "@/context/localization-context";
import { useCurrency } from "@/contexts/currency-context";
import type { Card, Offer, Transaction } from "@/lib/types";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { ArrowLeft, Clock, Tag, Ticket, Hammer, Send, CheckCircle, MessageCircle, Phone, Loader2 } from "lucide-react";

export default function CardDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const cardId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen } = useAuthModal();
    const { t } = useLocalization();
    const { formatPrice } = useCurrency();

    const [card, setCard] = useState<Card | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [offers, setOffers] = useState<Offer[]>([]);
    const [offerPrice, setOfferPrice] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

    const isOwner = user?.id === card?.sellerId;

    // Find user's existing offer
    const myOffer = offers.find(offer => offer.buyerId === user?.id);

    // Helper to map offers from Supabase format
    const mapOffer = (o: any): Offer => ({
        id: o.id,
        cardId: o.card_id,
        buyerId: o.buyer_id,
        buyerEmail: o.buyer_email,
        price: o.price,
        message: o.message,
        status: o.status,
        transactionId: o.transaction_id,
        createdAt: o.created_at,
    });

    // Helper to map card from Supabase format
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
    });

    // Fetch card data
    useEffect(() => {
        const fetchCard = async () => {
            try {
                const { data, error } = await supabase
                    .from('cards')
                    .select('*')
                    .eq('id', cardId)
                    .single();

                if (data && !error) {
                    setCard(mapCard(data));
                }
            } catch (error) {
                console.error("Error fetching card:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchCard();
    }, [cardId]); // supabase is stable singleton

    // Subscribe to offers (for sale listings)
    useEffect(() => {
        if (!card || card.listingType !== "sale") return;

        // Initial fetch
        const fetchOffers = async () => {
            const { data } = await supabase
                .from('offers')
                .select('*')
                .eq('card_id', cardId)
                .order('price', { ascending: false });

            if (data) {
                setOffers(data.map(mapOffer));
            }
        };
        fetchOffers();

        // Subscribe to realtime updates
        const channel = supabase
            .channel(`offers-${cardId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'offers',
                    filter: `card_id=eq.${cardId}`,
                },
                () => {
                    fetchOffers(); // Refetch on any change
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [card, cardId]); // supabase is stable singleton

    // Submit or update offer
    const handleSubmitOffer = async () => {
        if (!user) {
            setOpen(true);
            return;
        }
        if (!offerPrice || isNaN(Number(offerPrice))) return;

        setIsSubmitting(true);
        try {
            if (myOffer) {
                // Update existing offer
                await supabase
                    .from('offers')
                    .update({ price: Number(offerPrice) })
                    .eq('id', myOffer.id);
            } else {
                // Create new offer
                await supabase.from('offers').insert({
                    card_id: cardId,
                    buyer_id: user.id,
                    price: Number(offerPrice),
                    status: 'pending',
                });

                // Send notification to seller
                if (card?.sellerId) {
                    await supabase.from('notifications').insert({
                        user_id: card.sellerId,
                        type: 'offer_received',
                        title: 'Đề xuất giá mới',
                        message: `Có người đề xuất ${formatPrice(Number(offerPrice))} cho thẻ "${card.name}"`,
                        card_id: cardId,
                        read: false,
                    });
                }
            }
            setOfferPrice("");
            setIsEditing(false);
        } catch (error) {
            console.error("Error submitting offer:", error);
        } finally {
            setIsSubmitting(false);
        }
    };


    // Accept offer
    const handleAcceptOffer = async (offer: Offer) => {
        if (acceptingOfferId) return; // Already accepting another offer

        setAcceptingOfferId(offer.id);

        try {
            console.log("Accepting offer:", offer);
            console.log("Card data:", card);

            // Create transaction with 2-hour expiry
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 2);

            // Create transaction document
            const { data: transactionData, error: txError } = await supabase
                .from('transactions')
                .insert({
                    card_id: cardId,
                    seller_id: card!.sellerId,
                    buyer_id: offer.buyerId,
                    offer_id: offer.id,
                    price: offer.price,
                    status: 'active',
                    expires_at: expiresAt.toISOString(),
                })
                .select()
                .single();

            if (txError || !transactionData) {
                console.error("Error creating transaction:", txError);
                return;
            }
            console.log("Transaction created:", transactionData.id);

            // Update offer status to 'chosen'
            await supabase
                .from('offers')
                .update({ status: 'chosen', transaction_id: transactionData.id })
                .eq('id', offer.id);
            console.log("Offer updated");

            // Update card status to 'in_transaction'
            await supabase
                .from('cards')
                .update({ status: 'in_transaction' })
                .eq('id', cardId);
            console.log("Card updated");

            // Send notification to buyer
            await supabase.from('notifications').insert({
                user_id: offer.buyerId,
                type: 'offer_accepted',
                title: 'Đề xuất được chấp nhận!',
                message: `Người bán đã chấp nhận đề xuất ${formatPrice(offer.price)} của bạn. Vào phòng giao dịch ngay!`,
                card_id: cardId,
                offer_id: offer.id,
                read: false,
            });
            console.log("Notification sent");

            // Navigate to transaction room
            router.push(`/transaction/${transactionData.id}`);
        } catch (error) {
            console.error("Error accepting offer:", error);
            console.error("Error details:", JSON.stringify(error, null, 2));
            setAcceptingOfferId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Skeleton className="h-96 w-full rounded-2xl" />
            </div>
        );
    }

    if (!card) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <p className="text-xl text-muted-foreground">Không tìm thấy thẻ</p>
                <Button onClick={() => router.back()} className="mt-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            {/* Back button */}
            <Button variant="ghost" onClick={() => router.back()} className="mb-6">
                <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
            </Button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Card Details - Left Side (2/3 width) */}
                <div className="lg:col-span-2 space-y-6">
                    <div>
                        <Badge variant="secondary" className="mb-2">
                            {card.category}
                        </Badge>
                        <h1 className="text-3xl font-bold mb-2">{card.name}</h1>
                        {card.condition && (
                            <Badge variant="outline">{card.condition}</Badge>
                        )}
                        {isOwner && (
                            <Badge className="ml-2 bg-primary text-white">
                                Thẻ của bạn
                            </Badge>
                        )}
                    </div>

                    {card.description && (
                        <p className="text-muted-foreground">{card.description}</p>
                    )}

                    {/* Sale Layout */}
                    {card.listingType === "sale" && (
                        <CardUI className="border-primary/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Tag className="h-5 w-5" />
                                    Mua Ngay
                                    {card.status === 'sold' && (
                                        <Badge className="ml-2 bg-green-500">Đã bán</Badge>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {card.status === 'sold' ? (
                                    <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                                        <p className="text-green-500 font-bold text-xl mb-2">🎉 Đã bán thành công!</p>
                                        {card.lastSoldPrice && (
                                            <p className="text-2xl font-bold">{formatPrice(card.lastSoldPrice)}</p>
                                        )}
                                        <p className="text-sm text-muted-foreground mt-2">Thẻ này không còn nhận đề xuất</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-3xl font-bold text-primary break-words">
                                            {card.price ? formatPrice(card.price) : "Liên hệ"}
                                        </div>

                                        {card.lastSoldPrice && (
                                            <p className="text-sm text-muted-foreground">
                                                Giá bán gần nhất: {formatPrice(card.lastSoldPrice)}
                                            </p>
                                        )}

                                        {!isOwner ? (
                                            <div className="space-y-4">
                                                {/* Show existing offer or input form */}
                                                {myOffer && !isEditing ? (
                                                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
                                                        <p className="text-sm text-muted-foreground mb-1">Đề xuất của bạn:</p>
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <p className="text-2xl font-bold text-primary break-words">{formatPrice(myOffer.price)}</p>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setOfferPrice(myOffer.price.toString());
                                                                    setIsEditing(true);
                                                                }}
                                                            >
                                                                Chỉnh sửa
                                                            </Button>
                                                        </div>
                                                        {myOffer.status === "pending" && (
                                                            <p className="text-xs text-muted-foreground mt-2">Đang chờ người bán phản hồi...</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        <p className="text-sm text-muted-foreground">
                                                            {isEditing ? "Chỉnh sửa giá đề xuất:" : "Đề xuất giá của bạn:"}
                                                        </p>
                                                        <div className="flex gap-2">
                                                            <Input
                                                                type="number"
                                                                placeholder="Nhập giá đề xuất..."
                                                                value={offerPrice}
                                                                onChange={(e) => setOfferPrice(e.target.value)}
                                                                className="flex-1"
                                                            />
                                                            <Button onClick={handleSubmitOffer} disabled={isSubmitting}>
                                                                <Send className="h-4 w-4 mr-2" />
                                                                {isEditing ? "Cập nhật" : "Gửi"}
                                                            </Button>
                                                            {isEditing && (
                                                                <Button variant="ghost" onClick={() => setIsEditing(false)}>
                                                                    Hủy
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Show previous offers with blurred user info */}
                                                {offers.length > 0 && (
                                                    <div className="space-y-2 mt-4">
                                                        <h4 className="text-sm font-medium text-muted-foreground">Các đề xuất trước đó:</h4>
                                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                                            {offers.map((offer) => {
                                                                const isMyOffer = user?.uid === offer.buyerId;
                                                                return (
                                                                    <div
                                                                        key={offer.id}
                                                                        className={`flex items-center justify-between p-3 rounded-lg border ${isMyOffer ? 'bg-primary/10 border-primary/30' : 'bg-muted/50'}`}
                                                                    >
                                                                        <div>
                                                                            <p className="font-medium">{formatPrice(offer.price)}</p>
                                                                            <p className={`text-xs text-muted-foreground ${!isMyOffer ? 'blur-sm select-none' : ''}`}>
                                                                                {isMyOffer ? 'Bạn' : offer.buyerEmail} • {formatDistanceToNow(new Date(offer.createdAt), { addSuffix: true, locale: vi })}
                                                                            </p>
                                                                        </div>
                                                                        {isMyOffer && (
                                                                            <Badge variant="outline">Của bạn</Badge>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                <h3 className="font-semibold">Danh sách đề xuất giá ({offers.length})</h3>
                                                {offers.length === 0 ? (
                                                    <p className="text-muted-foreground text-sm">Chưa có đề xuất nào</p>
                                                ) : (
                                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                                        {offers.map((offer) => (
                                                            <div
                                                                key={offer.id}
                                                                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                                                            >
                                                                <div>
                                                                    <p className="font-medium">{formatPrice(offer.price)}</p>
                                                                    <p className="text-xs text-muted-foreground">
                                                                        {offer.buyerEmail} • {formatDistanceToNow(new Date(offer.createdAt), { addSuffix: true, locale: vi })}
                                                                    </p>
                                                                </div>
                                                                {offer.status === "pending" ? (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleAcceptOffer(offer)}
                                                                        disabled={!!acceptingOfferId}
                                                                    >
                                                                        {acceptingOfferId === offer.id ? (
                                                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                                                        ) : (
                                                                            <CheckCircle className="h-4 w-4 mr-1" />
                                                                        )}
                                                                        {acceptingOfferId === offer.id ? "Đang xử lý..." : "Chấp nhận"}
                                                                    </Button>
                                                                ) : offer.status === "chosen" ? (
                                                                    <Badge className="bg-green-500">Đã chọn</Badge>
                                                                ) : (
                                                                    <Badge variant="secondary">Đã chấp nhận</Badge>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </CardUI>
                    )}

                    {/* Auction Layout */}
                    {card.listingType === "auction" && (
                        <CardUI className="border-amber-500/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Hammer className="h-5 w-5" />
                                    Đấu Giá
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap justify-between items-center gap-2">
                                    <div className="max-w-full">
                                        <p className="text-sm text-muted-foreground">Giá hiện tại</p>
                                        <p className="text-3xl font-bold text-amber-500 break-words">
                                            {card.currentBid ? formatPrice(card.currentBid) : formatPrice(card.startingBid || 0)}
                                        </p>
                                    </div>
                                    {card.auctionEnds && (
                                        <div className="text-right">
                                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                                                <Clock className="h-4 w-4" /> Kết thúc sau
                                            </p>
                                            <p className="font-medium">
                                                {formatDistanceToNow(new Date(card.auctionEnds), { locale: vi })}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {!isOwner && (
                                    <div className="flex gap-2">
                                        <Input type="number" placeholder="Nhập giá đấu..." className="flex-1" />
                                        <Button className="bg-amber-500 hover:bg-amber-600">
                                            <Hammer className="h-4 w-4 mr-2" />
                                            Đấu giá
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </CardUI>
                    )}

                    {/* Razz Layout */}
                    {card.listingType === "razz" && (
                        <CardUI className="border-purple-500/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Ticket className="h-5 w-5" />
                                    Razz
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap justify-between items-center gap-2">
                                    <div className="max-w-full">
                                        <p className="text-sm text-muted-foreground">Giá vé</p>
                                        <p className="text-3xl font-bold text-purple-500 break-words">
                                            {card.ticketPrice ? formatPrice(card.ticketPrice) : "N/A"}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">Đã bán</p>
                                        <p className="font-medium">
                                            {card.razzEntries || 0} / {card.totalTickets || 0} vé
                                        </p>
                                    </div>
                                </div>

                                <div className="w-full bg-muted rounded-full h-3">
                                    <div
                                        className="bg-purple-500 h-3 rounded-full transition-all"
                                        style={{ width: `${((card.razzEntries || 0) / (card.totalTickets || 1)) * 100}%` }}
                                    />
                                </div>

                                {!isOwner && (
                                    <div className="flex gap-2">
                                        <Input type="number" placeholder="Số vé..." defaultValue="1" min="1" className="w-24" />
                                        <Button className="flex-1 bg-purple-500 hover:bg-purple-600">
                                            <Ticket className="h-4 w-4 mr-2" />
                                            Mua Vé
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </CardUI>
                    )}

                    {/* Seller Info */}
                    <div className="p-4 rounded-lg bg-muted/50 border">
                        <p className="text-sm text-muted-foreground mb-1">Người bán</p>
                        <p className="font-medium">{card.author}</p>
                    </div>
                </div>

                {/* Card Image - Right Side (1/3 width) */}
                <div className="lg:col-span-1">
                    <div className="sticky top-24">
                        <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted/30 border">
                            <Image
                                src={card.imageUrl}
                                alt={card.name}
                                fill
                                className="object-contain p-2"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
