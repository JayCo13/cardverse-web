"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Card, Offer } from "@/lib/types";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageCircle, Phone, CheckCircle, ExternalLink } from "lucide-react";
import Image from "next/image";
import { useLocalization } from "@/context/localization-context";
import { useCurrency } from "@/contexts/currency-context";

export default function ConnectPage() {
    const params = useParams();
    const router = useRouter();
    const cardId = params.id as string;
    const offerId = params.offerId as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { formatPrice } = useCurrency();
    const { locale } = useLocalization();
    const copy = locale === "vi-VN"
        ? {
            notFound: "Không tìm thấy thông tin",
            back: "Quay lại",
            noAccess: "Bạn không có quyền truy cập trang này",
            home: "Về trang chủ",
            backToCard: "Quay lại chi tiết thẻ",
            successTitle: "Giao dịch thành công!",
            successDesc: "Đề xuất giá đã được chấp nhận. Vui lòng liên hệ để hoàn tất giao dịch.",
            contactInfo: "Thông tin liên hệ",
            seller: "Người bán",
            buyer: "Người mua",
            you: "Bạn",
            instructions: "Hướng dẫn:",
            step1: "Liên hệ với đối tác qua Zalo hoặc Facebook",
            step2: "Thống nhất phương thức thanh toán và giao nhận",
            step3: "Hoàn tất giao dịch ngoài hệ thống",
        }
        : locale === "ja-JP"
            ? {
                notFound: "情報が見つかりません",
                back: "戻る",
                noAccess: "このページにアクセスする権限がありません",
                home: "ホームへ",
                backToCard: "カード詳細へ戻る",
                successTitle: "取引が成立しました！",
                successDesc: "価格オファーが承認されました。取引完了のため相手に連絡してください。",
                contactInfo: "連絡先情報",
                seller: "販売者",
                buyer: "購入者",
                you: "あなた",
                instructions: "手順:",
                step1: "Zalo または Facebook で相手に連絡する",
                step2: "支払い方法と受け渡し方法を確認する",
                step3: "システム外で取引を完了する",
            }
            : {
                notFound: "Information not found",
                back: "Back",
                noAccess: "You do not have access to this page",
                home: "Go to homepage",
                backToCard: "Back to card details",
                successTitle: "Transaction successful!",
                successDesc: "The offer has been accepted. Please contact the other party to complete the deal.",
                contactInfo: "Contact information",
                seller: "Seller",
                buyer: "Buyer",
                you: "You",
                instructions: "Instructions:",
                step1: "Contact the other party via Zalo or Facebook",
                step2: "Agree on payment and delivery details",
                step3: "Complete the transaction outside the system",
            };

    const [card, setCard] = useState<Card | null>(null);
    const [offer, setOffer] = useState<Offer | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch card
                const { data: cardData } = await supabase
                    .from('cards')
                    .select('*')
                    .eq('id', cardId)
                    .single();

                if (cardData) {
                    const c = cardData as any;
                    setCard({
                        id: c.id,
                        name: c.name,
                        imageUrl: c.image_url || '',
                        imageUrls: c.image_urls,
                        category: c.category,
                        condition: c.condition,
                        listingType: c.listing_type,
                        price: c.price,
                        sellerId: c.seller_id,
                        author: c.seller_id,
                        description: c.description,
                        status: c.status,
                    });
                }

                // Fetch offer
                const { data: offerData } = await supabase
                    .from('offers')
                    .select('*')
                    .eq('id', offerId)
                    .single();

                if (offerData) {
                    const o = offerData as any;
                    setOffer({
                        id: o.id,
                        cardId: o.card_id,
                        buyerId: o.buyer_id,
                        buyerEmail: o.buyer_email,
                        price: o.price,
                        status: o.status,
                        createdAt: o.created_at,
                    });
                }
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [cardId, offerId]); // supabase is stable singleton

    // Check if user is authorized (either buyer or seller)
    const isSeller = user?.id === card?.sellerId;
    const isBuyer = user?.id === offer?.buyerId;
    const isAuthorized = isSeller || isBuyer;

    if (isLoading) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
        );
    }

    if (!card || !offer) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <p className="text-xl text-muted-foreground">{copy.notFound}</p>
                <Button onClick={() => router.back()} className="mt-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> {copy.back}
                </Button>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <p className="text-xl text-muted-foreground">{copy.noAccess}</p>
                <Button onClick={() => router.push("/")} className="mt-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> {copy.home}
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Back button */}
            <Button variant="ghost" onClick={() => router.push(`/cards/${cardId}`)} className="mb-6">
                <ArrowLeft className="mr-2 h-4 w-4" /> {copy.backToCard}
            </Button>

            {/* Success Banner */}
            <div className="bg-green-500/10 border border-green-500/50 rounded-2xl p-6 mb-6 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <h1 className="text-2xl font-bold text-green-500 mb-2">{copy.successTitle}</h1>
                <p className="text-muted-foreground">
                    {copy.successDesc}
                </p>
            </div>

            {/* Card Info */}
            <CardUI className="mb-6">
                <CardContent className="p-4">
                    <div className="flex gap-4">
                        <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
                            <Image src={card.imageUrl} alt={card.name} fill className="object-cover" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold">{card.name}</h3>
                            <p className="text-sm text-muted-foreground">{card.category}</p>
                            <p className="text-lg font-bold text-primary mt-1">
                                {formatPrice(offer.price)}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </CardUI>

            {/* Contact Information */}
            <CardUI>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageCircle className="h-5 w-5" />
                        {copy.contactInfo}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Seller Info */}
                    <div className="p-4 rounded-lg bg-muted/50 border">
                        <div className="flex items-center justify-between mb-3">
                            <Badge variant="secondary">{copy.seller}</Badge>
                            {isSeller && <Badge>{copy.you}</Badge>}
                        </div>
                        <p className="font-medium mb-3">{card.author}</p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" asChild className="flex-1">
                                <a href={`https://zalo.me/`} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-4 w-4 mr-1" />
                                    Zalo
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="flex-1">
                                <a href={`https://facebook.com/`} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-4 w-4 mr-1" />
                                    Facebook
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </Button>
                        </div>
                    </div>

                    {/* Buyer Info */}
                    <div className="p-4 rounded-lg bg-muted/50 border">
                        <div className="flex items-center justify-between mb-3">
                            <Badge variant="secondary">{copy.buyer}</Badge>
                            {isBuyer && <Badge>{copy.you}</Badge>}
                        </div>
                        <p className="font-medium mb-3">{offer.buyerEmail}</p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" asChild className="flex-1">
                                <a href={`https://zalo.me/`} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-4 w-4 mr-1" />
                                    Zalo
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="flex-1">
                                <a href={`https://facebook.com/`} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-4 w-4 mr-1" />
                                    Facebook
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </Button>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="text-sm text-muted-foreground border-t pt-4">
                        <p className="font-medium mb-2">{copy.instructions}</p>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>{copy.step1}</li>
                            <li>{copy.step2}</li>
                            <li>{copy.step3}</li>
                        </ol>
                    </div>
                </CardContent>
            </CardUI>
        </div>
    );
}
