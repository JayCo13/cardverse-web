"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import {
    ArrowLeft,
    BadgeCheck,
    CalendarDays,
    CheckCircle,
    Heart,
    Loader2,
    MessageCircle,
    PackageCheck,
    Search,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { CheckoutModal } from "@/components/checkout-modal";
import { ChatDrawer } from "@/components/chat-drawer";
import { OfferModal } from "@/components/offer-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthModal } from "@/components/auth-modal";
import { useSupabase, useUser } from "@/lib/supabase";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import type { Card, Offer } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

type SellerProfile = {
    id: string;
    email?: string | null;
    display_name?: string | null;
    profile_image_url?: string | null;
    seller_verified?: boolean | null;
    seller_rating?: number | null;
    seller_review_count?: number | null;
    address_district_id?: number | null;
    address_ward_code?: string | null;
};

type CheckoutCard = {
    id: string;
    name: string;
    image_url: string;
    price: number;
    category: string;
    condition: string;
    seller_id: string;
};

const formatVND = (amount: number | null | undefined) =>
    amount === null || amount === undefined
        ? "Liên hệ"
        : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const mapOffer = (o: any): Offer => ({
    id: o.id,
    cardId: o.card_id,
    buyerId: o.buyer_id,
    buyerEmail: o.buyer_email || "Người mua",
    price: o.price,
    message: o.message,
    status: o.status,
    transactionId: o.transaction_id,
    createdAt: o.created_at,
});

const mapCard = (c: any): Card => ({
    id: c.id,
    name: c.name,
    imageUrl: c.image_url || "",
    imageUrls: c.image_urls || [],
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
    author: c.profiles?.display_name || c.seller_id,
    sellerName: c.profiles?.display_name || "Người bán CardVerse",
    sellerAvatar: c.profiles?.profile_image_url || undefined,
    description: c.description,
    lastSoldPrice: c.last_sold_price,
    status: c.status,
    publisher: c.publisher,
    season: c.season,
    quantity: c.quantity,
    setName: c.set_name,
    isBundle: c.is_bundle,
    bundleItems: c.bundle_items,
    acceptOffers: c.accept_offers,
    minOfferPercent: c.min_offer_percent,
    priceIsVnd: true,
});

function RelatedRail({ title, subtitle, cards }: { title: string; subtitle?: string; cards: Card[] }) {
    if (cards.length === 0) return null;

    return (
        <section className="space-y-3">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-semibold tracking-normal">{title}</h2>
                    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                </div>
                <button type="button" className="text-sm font-medium underline underline-offset-4">
                    Xem tất cả
                </button>
            </div>
            <div className="relative">
                <button
                    type="button"
                    className="absolute -left-3 top-24 z-10 hidden h-10 w-10 items-center justify-center rounded-full border bg-background shadow md:flex"
                    aria-label="Previous related items"
                >
                    ‹
                </button>
                <button
                    type="button"
                    className="absolute -right-3 top-24 z-10 hidden h-10 w-10 items-center justify-center rounded-full border bg-background shadow md:flex"
                    aria-label="Next related items"
                >
                    ›
                </button>
                <div className="flex gap-5 overflow-x-auto pb-2">
                    {cards.map(item => (
                        <a key={item.id} href={`/cards/${item.id}`} className="group w-[210px] shrink-0">
                            <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                                <Image
                                    src={optimizeCloudinaryUrl(item.imageUrl, 420)}
                                    alt={item.name}
                                    fill
                                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                                <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow">
                                    <Heart className="h-4 w-4" />
                                </span>
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm font-medium underline-offset-2 group-hover:underline">{item.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.condition || "Pre-owned"}</p>
                            <p className="mt-1 font-semibold">{formatVND(item.price)}</p>
                            <p className="text-xs text-muted-foreground">Seller trên CardVerse</p>
                        </a>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default function CardDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const cardId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen: setAuthOpen } = useAuthModal();
    const { toast } = useToast();

    const [card, setCard] = useState<Card | null>(null);
    const [seller, setSeller] = useState<SellerProfile | null>(null);
    const [relatedCards, setRelatedCards] = useState<Card[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [offers, setOffers] = useState<Offer[]>([]);
    const [activeImage, setActiveImage] = useState("");
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [offerOpen, setOfferOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatConversationId, setChatConversationId] = useState<string | null>(null);
    const [startingChatOfferId, setStartingChatOfferId] = useState<string | null>(null);
    const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

    const isOwner = user?.id === card?.sellerId;
    const isSale = card?.listingType === "sale";
    const isUnavailable = card?.status === "sold" || card?.status === "in_transaction" || card?.status === "expired";
    const myOffer = offers.find(offer => offer.buyerId === user?.id);

    const images = useMemo(() => {
        if (!card) return [];
        return Array.from(new Set([card.imageUrl, ...(card.imageUrls || [])].filter(Boolean)));
    }, [card]);

    const sellerAddress = useMemo(() => {
        if (!seller?.address_district_id || !seller?.address_ward_code) return null;
        return {
            districtId: seller.address_district_id,
            wardCode: seller.address_ward_code,
        };
    }, [seller]);

    const checkoutCard: CheckoutCard | null = card ? {
        id: card.id,
        name: card.name,
        image_url: card.imageUrl,
        price: card.price ?? 0,
        category: card.category,
        condition: card.condition || "",
        seller_id: card.sellerId,
    } : null;

    const itemSpecifics = useMemo(() => {
        if (!card) return [];
        return [
            ["Condition", card.condition || "Ungraded - Near mint or better"],
            ["Category", card.category],
            ["Set", card.setName || "Not specified"],
            ["Player/Athlete", card.name],
            ["Manufacturer", card.publisher || "Not specified"],
            ["Season", card.season || "Not specified"],
            ["Type", "Sports Trading Card"],
            ["Card Size", "Standard"],
            ["Autographed", card.name.toLowerCase().includes("auto") ? "Yes" : "No"],
            ["Original/Licensed Reprint", "Original"],
            ["Graded", card.condition?.toLowerCase().includes("psa") ? "Yes" : "No"],
            ["Sport", card.category],
        ];
    }, [card]);

    const fetchRelatedCards = useCallback(async (baseCard: Card) => {
        const { data } = await supabase
            .from("cards")
            .select("*, profiles:seller_id(display_name, profile_image_url)")
            .eq("listing_type", "sale")
            .neq("id", baseCard.id)
            .limit(12);

        if (!data) return;

        const mapped = (data as any[]).map(mapCard);
        const closest = mapped.filter(item =>
            item.category === baseCard.category ||
            item.publisher === baseCard.publisher ||
            item.setName === baseCard.setName
        );
        setRelatedCards(closest.length > 0 ? closest : mapped);
    }, [supabase]);

    const fetchCard = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from("cards")
                .select(`
                    *,
                    profiles:seller_id(
                        id,
                        email,
                        display_name,
                        profile_image_url,
                        seller_verified,
                        seller_rating,
                        seller_review_count,
                        address_district_id,
                        address_ward_code
                    )
                `)
                .eq("id", cardId)
                .single();

            if (data && !error) {
                const mapped = mapCard(data);
                setCard(mapped);
                setSeller((data as any).profiles || null);
                setActiveImage(mapped.imageUrl || mapped.imageUrls?.[0] || "");
                void fetchRelatedCards(mapped);
            } else {
                setCard(null);
                setSeller(null);
            }
        } catch (error) {
            console.error("Error fetching card:", error);
            setCard(null);
            setSeller(null);
        } finally {
            setIsLoading(false);
        }
    }, [cardId, fetchRelatedCards, supabase]);

    const fetchOffers = useCallback(async () => {
        const { data } = await supabase
            .from("offers")
            .select("*")
            .eq("card_id", cardId)
            .order("price", { ascending: false });

        if (data) setOffers((data as any[]).map(mapOffer));
    }, [cardId, supabase]);

    useEffect(() => {
        void fetchCard();
    }, [fetchCard]);

    useEffect(() => {
        if (!card || card.listingType !== "sale") return;

        void fetchOffers();
        const channel = supabase
            .channel(`offers-${cardId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "offers", filter: `card_id=eq.${cardId}` },
                () => void fetchOffers(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [card, cardId, fetchOffers, supabase]);

    const handleBuyNow = () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card || isOwner || isUnavailable) return;
        setCheckoutOpen(true);
    };

    const handleMakeOffer = () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card || isOwner || isUnavailable) return;
        setOfferOpen(true);
    };

    const handleStartChat = async (offerId?: string) => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card) return;
        if (isOwner && !offerId) return;

        setStartingChatOfferId(offerId || "listing");
        try {
            const response = await fetch("/api/chat/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cardId: card.id, offerId }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Không thể mở chat");
            setChatConversationId(payload.conversation.id);
            setChatOpen(true);
        } catch (error) {
            const description = error instanceof Error ? error.message : "Không thể mở chat";
            toast({ variant: "destructive", title: "Lỗi chat", description });
        } finally {
            setStartingChatOfferId(null);
        }
    };

    const handleAcceptOffer = async (offer: Offer) => {
        if (!card || acceptingOfferId) return;
        setAcceptingOfferId(offer.id);

        try {
            // All the seller/offer/card validation, card locking, transaction
            // creation and notification now happen server-side.
            const response = await fetch(`/api/offers/${offer.id}/accept`, { method: "POST" });
            const payload = await response.json();

            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: "Không thể chấp nhận đề nghị",
                    description: payload.error || "Vui lòng thử lại.",
                });
                setAcceptingOfferId(null);
                return;
            }

            router.push(`/transaction/${payload.transactionId}`);
        } catch (error) {
            console.error("Error accepting offer:", error);
            toast({
                variant: "destructive",
                title: "Không thể chấp nhận đề nghị",
                description: "Đã xảy ra lỗi. Vui lòng thử lại.",
            });
            setAcceptingOfferId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-8">
                    <Skeleton className="h-[620px] w-full rounded-xl" />
                </main>
                <Footer />
            </div>
        );
    }

    if (!card) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-16 text-center">
                    <p className="text-xl text-muted-foreground">Không tìm thấy thẻ</p>
                    <Button onClick={() => router.back()} className="mt-4">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
                    </Button>
                </main>
                <Footer />
            </div>
        );
    }

    if (!isSale) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-8">
                    <Button variant="ghost" onClick={() => router.back()} className="mb-6">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
                    </Button>
                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                        <div className="lg:col-span-2 space-y-4">
                            <Badge variant="secondary">{card.category}</Badge>
                            <h1 className="text-3xl font-bold">{card.name}</h1>
                            <p className="text-muted-foreground">{card.description || "Chưa có mô tả."}</p>
                            <div className="rounded-lg border bg-card p-5">
                                <p className="text-sm text-muted-foreground">
                                    {card.listingType === "auction" ? "Đấu giá" : "Razz"}
                                </p>
                                <p className="mt-2 text-3xl font-bold text-primary">
                                    {card.listingType === "auction"
                                        ? formatVND(card.currentBid || card.startingBid || 0)
                                        : formatVND(card.ticketPrice || 0)}
                                </p>
                            </div>
                        </div>
                        <div className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted/30">
                            <Image src={optimizeCloudinaryUrl(card.imageUrl, 900)} alt={card.name} fill className="object-contain p-3" />
                        </div>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    const displayRelatedCards = relatedCards.length > 0 ? relatedCards : [card];

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Header />
            <main className="flex-1">
                <div className="mx-auto w-full max-w-[1820px] space-y-8 px-4 py-6 sm:px-6">
                    <div className="hidden items-center gap-5 border-b pb-6 lg:grid lg:grid-cols-[230px_minmax(0,1fr)_210px_160px]">
                        <div className="flex items-center">
                            <Image
                                src="/assets/logo-verse.png"
                                width={220}
                                height={56}
                                alt="CardVerse logo"
                                className="h-auto w-[210px] object-contain"
                                priority
                            />
                        </div>
                        <div className="flex h-14 items-center rounded-full border-2 border-foreground bg-background px-5">
                            <Search className="mr-4 h-6 w-6 text-muted-foreground" />
                            <input
                                aria-label="Search marketplace"
                                className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none"
                                placeholder="Search for cards, players, sets..."
                            />
                        </div>
                        <select className="h-14 rounded-full border bg-background px-5 text-sm outline-none">
                            <option>All Categories</option>
                            <option>Pokemon</option>
                            <option>Soccer</option>
                            <option>One Piece</option>
                        </select>
                        <Button className="h-14 rounded-full bg-orange-500 text-lg font-bold text-white shadow-[0_0_24px_rgba(249,115,22,0.28)] hover:bg-orange-600">
                            Search
                        </Button>
                    </div>

                    <Button variant="ghost" onClick={() => router.back()} className="h-9 px-2 text-muted-foreground">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
                    </Button>

                    <div className="rounded-xl border bg-card px-4 py-3">
                        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
                            <span className="text-muted-foreground">Find similar items from</span>
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 font-bold text-white">
                                {(seller?.display_name || "C").charAt(0).toUpperCase()}
                            </span>
                            <span className="font-semibold">{seller?.display_name || "CardVerse seller"}</span>
                            <span className="text-muted-foreground">({seller?.seller_review_count || 0} items sold)</span>
                            <button type="button" className="font-semibold underline underline-offset-4">Shop store on CardVerse</button>
                            <span className="ml-auto hidden text-muted-foreground md:block">Sponsored</span>
                        </div>
                    </div>

                    <RelatedRail title="People who viewed this item also viewed" cards={displayRelatedCards.slice(0, 6)} />

                    <section className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,920px)_minmax(460px,1fr)] 2xl:grid-cols-[minmax(0,980px)_minmax(520px,1fr)]">
                        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[96px_minmax(0,1fr)]">
                            <div className="order-2 flex gap-3 overflow-x-auto lg:order-1 lg:block lg:space-y-3 lg:overflow-visible">
                                {images.map((image, index) => (
                                    <button
                                        key={`${image}-${index}`}
                                        type="button"
                                        onClick={() => setActiveImage(image)}
                                        className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border bg-card transition lg:h-28 lg:w-full ${
                                            activeImage === image ? "border-foreground ring-2 ring-foreground/20" : "border-border hover:border-muted-foreground"
                                        }`}
                                        aria-label={`Xem ảnh ${index + 1}`}
                                    >
                                        <Image src={optimizeCloudinaryUrl(image, 220)} alt="" fill className="object-contain p-1" />
                                    </button>
                                ))}
                            </div>

                            <div className="order-1 lg:order-2">
                                <div className="relative aspect-square overflow-hidden rounded-xl bg-muted lg:h-[680px] lg:aspect-auto xl:h-[720px]">
                                    {activeImage ? (
                                        <Image
                                            src={optimizeCloudinaryUrl(activeImage, 1400)}
                                            alt={card.name}
                                            fill
                                            priority
                                            sizes="(max-width: 1024px) 100vw, 52vw"
                                            className={`object-contain ${card.status === "sold" ? "grayscale" : ""}`}
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-muted-foreground">Không có ảnh</div>
                                    )}
                                    <div className="absolute right-5 top-5 flex gap-3">
                                        <button type="button" className="flex h-14 w-14 items-center justify-center rounded-full bg-background/90 shadow">
                                            <Search className="h-6 w-6" />
                                        </button>
                                        <button type="button" className="flex h-14 w-14 items-center justify-center rounded-full bg-background/90 shadow">
                                            <Heart className="h-6 w-6" />
                                        </button>
                                    </div>
                                    {isUnavailable && (
                                        <div className="absolute left-5 top-5 rounded-full bg-red-600 px-4 py-1.5 text-sm font-bold text-white">
                                            {card.status === "sold" ? "Đã bán" : card.status === "in_transaction" ? "Đang giữ thanh toán" : "Không còn khả dụng"}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <aside className="space-y-4">
                            <div className="space-y-4 border-b pb-4">
                                <h1 className="text-2xl font-semibold leading-tight tracking-normal md:text-3xl">
                                    {card.name}
                                </h1>
                                <div className="flex items-center gap-3">
                                    {seller?.profile_image_url ? (
                                        <Image src={seller.profile_image_url} alt="" width={44} height={44} className="rounded-full object-cover" />
                                    ) : (
                                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-500 font-bold text-white">
                                            {(seller?.display_name || "C").charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="truncate font-semibold">{seller?.display_name || card.sellerName || "Người bán CardVerse"}</span>
                                            {seller?.seller_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-orange-500" />}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {seller?.seller_rating ? `${Number(seller.seller_rating).toFixed(1)}% positive` : "Mới"} · Seller's other items
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="rounded-full border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                        onClick={() => void handleStartChat()}
                                        disabled={isOwner || startingChatOfferId === "listing"}
                                    >
                                        {startingChatOfferId === "listing" ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <MessageCircle className="mr-2 h-4 w-4" />
                                        )}
                                        Message
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-1 border-b pb-5">
                                <div className="flex items-end gap-2">
                                    <p className="text-4xl font-bold tracking-normal">{formatVND(card.price)}</p>
                                    {card.acceptOffers && <span className="pb-1 text-sm text-muted-foreground">or Best Offer</span>}
                                </div>
                                {card.lastSoldPrice && (
                                    <p className="text-sm text-muted-foreground">Approx. last sale {formatVND(card.lastSoldPrice)}</p>
                                )}
                            </div>

                            <div className="space-y-3 border-b pb-5 text-sm">
                                <div className="grid grid-cols-[130px_1fr] gap-3">
                                    <span className="font-medium">Condition:</span>
                                    <span>{card.condition || "Ungraded - Near mint or better"}</span>
                                </div>
                                <div className="grid grid-cols-[130px_1fr] gap-3">
                                    <span className="font-medium">Quantity:</span>
                                    <span>{card.quantity || 1} available</span>
                                </div>
                            </div>

                            {isOwner ? (
                                <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 text-sm text-orange-300">
                                    Đây là bài đăng của bạn. Buyer sẽ thấy nút mua và trả giá tại đây.
                                </div>
                            ) : isUnavailable ? (
                                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                                    {card.status === "sold"
                                        ? "Thẻ này đã được người khác mua."
                                        : "Thẻ này đang được giữ để thanh toán hoặc không còn khả dụng."}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Button className="h-12 w-full rounded-full bg-orange-500 text-base font-bold text-white shadow-[0_0_24px_rgba(249,115,22,0.22)] hover:bg-orange-600" onClick={handleBuyNow}>
                                        Buy It Now
                                    </Button>
                                    {card.acceptOffers && (
                                        <Button variant="outline" className="h-12 w-full rounded-full border-orange-500 text-base font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400" onClick={handleMakeOffer}>
                                            Make Offer
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        className="h-12 w-full rounded-full border-orange-500 text-base font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                        onClick={() => void handleStartChat()}
                                        disabled={startingChatOfferId === "listing"}
                                    >
                                        {startingChatOfferId === "listing" ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <MessageCircle className="mr-2 h-4 w-4" />
                                        )}
                                        Message seller
                                    </Button>
                                    <Button variant="outline" className="h-12 w-full rounded-full text-base font-bold">
                                        <Heart className="mr-2 h-4 w-4" />
                                        Add to Watchlist
                                    </Button>
                                </div>
                            )}

                            {myOffer && !isOwner && (
                                <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                                    <p className="text-muted-foreground">Your current offer</p>
                                    <p className="text-lg font-semibold">{formatVND(myOffer.price)}</p>
                                    <p className="text-xs text-muted-foreground">Status: {myOffer.status}</p>
                                </div>
                            )}

                            <div className="space-y-4 rounded-xl border bg-card p-5">
                                <h2 className="text-xl font-semibold">Shipping, returns, and payments</h2>
                                <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-4 text-sm">
                                    <span className="font-medium">Shipping:</span>
                                    <div>
                                        <p><b>GHN fee calculated at checkout</b></p>
                                        <p className="text-muted-foreground">Located in seller pickup area. Buyer address required.</p>
                                    </div>
                                    <span className="font-medium">Delivery:</span>
                                    <div>
                                        <p>Estimated after payment confirmation</p>
                                        <p className="text-muted-foreground">Seller ships after order is paid.</p>
                                    </div>
                                    <span className="font-medium">Returns:</span>
                                    <p>Marketplace dispute support if item does not match listing description.</p>
                                    <span className="font-medium">Payments:</span>
                                    <div className="flex flex-wrap gap-2">
                                        {["PayOS", "Wallet", "VISA", "Bank"].map(method => (
                                            <span key={method} className="rounded border bg-background px-2 py-1 text-xs font-semibold">{method}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </section>

                    <RelatedRail title="Similar Items" subtitle="Sponsored" cards={displayRelatedCards.slice(0, 6)} />

                    <section className="rounded-lg border bg-card">
                        <div className="border-b px-5 py-3">
                            <span className="rounded-t-md border bg-background px-4 py-3 text-sm font-semibold text-orange-500">About this item</span>
                        </div>
                        <div className="p-5">
                            <div className="mb-8 flex justify-between gap-4 text-sm text-muted-foreground">
                                <span>Seller assumes all responsibility for this listing.</span>
                                <span>CardVerse item number: <b>{card.id.slice(0, 8).toUpperCase()}</b></span>
                            </div>
                            <h2 className="mb-6 text-2xl font-bold tracking-normal">Item specifics</h2>
                            <div className="grid grid-cols-1 gap-x-12 gap-y-4 md:grid-cols-2">
                                {itemSpecifics.map(([label, value]) => (
                                    <div key={label} className="grid grid-cols-[160px_1fr] gap-4 text-sm">
                                        <span className="text-muted-foreground">{label}</span>
                                        <span className="font-medium">{value}</span>
                                    </div>
                                ))}
                            </div>
                            <h2 className="mb-4 mt-10 text-2xl font-bold tracking-normal">Item description from the seller</h2>
                            <div className="min-h-40 rounded-md bg-background p-5 text-sm leading-7">
                                {card.description || "Người bán chưa thêm mô tả chi tiết cho thẻ này."}
                            </div>
                        </div>
                    </section>

                    {isOwner && (
                        <section className="space-y-3 rounded-lg border bg-card p-5">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-xl font-semibold">Đề xuất giá ({offers.length})</h2>
                                <Badge variant="outline">Seller tools</Badge>
                            </div>
                            {offers.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Chưa có đề xuất nào cho listing này.</p>
                            ) : (
                                <div className="space-y-3">
                                    {offers.map(offer => (
                                        <div key={offer.id} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="text-lg font-semibold">{formatVND(offer.price)}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {offer.buyerEmail} · {formatDistanceToNow(new Date(offer.createdAt), { addSuffix: true, locale: vi })}
                                                </p>
                                                {offer.message && <p className="mt-1 text-sm text-muted-foreground">{offer.message}</p>}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                                    onClick={() => void handleStartChat(offer.id)}
                                                    disabled={startingChatOfferId === offer.id}
                                                >
                                                    {startingChatOfferId === offer.id ? (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <MessageCircle className="mr-2 h-4 w-4" />
                                                    )}
                                                    Chat
                                                </Button>
                                                {offer.status === "pending" ? (
                                                    <Button size="sm" onClick={() => handleAcceptOffer(offer)} disabled={!!acceptingOfferId}>
                                                        {acceptingOfferId === offer.id ? (
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <CheckCircle className="mr-2 h-4 w-4" />
                                                        )}
                                                        Chấp nhận
                                                    </Button>
                                                ) : (
                                                    <Badge className="w-fit bg-green-500">{offer.status === "chosen" ? "Đã chọn" : "Đã xử lý"}</Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    <section className="grid grid-cols-1 gap-8 bg-muted/40 p-6 md:grid-cols-[360px_1fr]">
                        <div className="space-y-5">
                            <h2 className="text-2xl font-bold tracking-normal">About this seller</h2>
                            <div className="flex items-center gap-4">
                                {seller?.profile_image_url ? (
                                    <Image src={seller.profile_image_url} alt="" width={92} height={92} className="rounded-full object-cover" />
                                ) : (
                                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-orange-500 text-4xl font-bold text-white">
                                        {(seller?.display_name || "C").charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div>
                                    <p className="text-xl font-semibold">{seller?.display_name || card.sellerName || "CardVerse seller"}</p>
                                    <p className="text-muted-foreground">{seller?.seller_rating ? `${Number(seller.seller_rating).toFixed(1)}% positive feedback` : "New seller"} · {seller?.seller_review_count || 0} items sold</p>
                                </div>
                            </div>
                            <div className="space-y-2 text-sm">
                                <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Joined CardVerse marketplace</p>
                                <p className="flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Usually ships after payment confirmation</p>
                            </div>
                            <Button className="h-11 w-full rounded-full bg-orange-500 font-bold text-white hover:bg-orange-600">Seller's other items</Button>
                            <Button
                                variant="outline"
                                className="h-11 w-full rounded-full border-orange-500 font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                onClick={() => void handleStartChat()}
                                disabled={isOwner || startingChatOfferId === "listing"}
                            >
                                {startingChatOfferId === "listing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Message seller
                            </Button>
                            <Button variant="outline" className="h-11 w-full rounded-full border-orange-500 font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400">Save seller</Button>
                        </div>
                        <div className="space-y-5">
                            <h2 className="text-2xl font-bold tracking-normal">Seller feedback <span className="text-muted-foreground">({seller?.seller_review_count || offers.length || 0})</span></h2>
                            {[1, 2, 3, 4].map((item) => (
                                <div key={item} className="border-b pb-4">
                                    <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                                        <span className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-xs text-white">+</span> Buyer feedback · Past month</span>
                                        <span>Verified purchase</span>
                                    </div>
                                    <p className="text-sm">Giao dịch nhanh, đóng gói cẩn thận, thẻ đúng như mô tả. Sẽ tiếp tục mua từ seller này.</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <RelatedRail title="Explore related items" subtitle="Sponsored" cards={displayRelatedCards.slice(0, 6)} />
                    <RelatedRail title="You may also like" cards={displayRelatedCards.slice(0, 6)} />
                </div>
            </main>
            <Footer />

            <CheckoutModal
                open={checkoutOpen}
                onOpenChange={setCheckoutOpen}
                card={checkoutCard}
                sellerAddress={sellerAddress}
                onSuccess={() => {
                    setCheckoutOpen(false);
                    void fetchCard();
                }}
            />
            <OfferModal
                open={offerOpen}
                onOpenChange={setOfferOpen}
                card={card ? {
                    id: card.id,
                    name: card.name,
                    imageUrl: card.imageUrl,
                    price: card.price ?? 0,
                    sellerId: card.sellerId,
                    minOfferPercent: card.minOfferPercent ?? 0,
                } : null}
                onSuccess={(conversationId) => {
                    setOfferOpen(false);
                    void fetchOffers();
                    if (conversationId) {
                        setChatConversationId(conversationId);
                        setChatOpen(true);
                    }
                }}
            />
            <ChatDrawer
                open={chatOpen}
                onOpenChange={setChatOpen}
                initialConversationId={chatConversationId}
            />
        </div>
    );
}
