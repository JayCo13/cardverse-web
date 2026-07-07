
"use client";

import React from "react";
import type { Card as CardType } from "@/lib/types";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, Tag, Ticket, Hammer, Zap, Sparkles, Target, Trophy, Star, Gem, Crown, Pencil, User, HandCoins, ShoppingCart, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocalization } from "@/context/localization-context";
import { useCurrency } from "@/contexts/currency-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useRouter } from "next/navigation";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCategoryCode } from "@/lib/category-code";

// Category badge styles with colors and gradients (no icons for cleaner look)
const getCategoryStyle = (category: string) => {
  const lowerCategory = category.toLowerCase();

  if (lowerCategory.includes('pokemon') || lowerCategory.includes('pokémon')) {
    return {
      gradient: 'bg-gradient-to-r from-yellow-400 via-yellow-500 to-orange-500',
      shadow: 'shadow-yellow-500/50',
    };
  }
  if (lowerCategory.includes('soccer') || lowerCategory.includes('football') || lowerCategory.includes('bóng đá')) {
    return {
      gradient: 'bg-gradient-to-r from-slate-400 via-gray-500 to-slate-600',
      shadow: 'shadow-slate-500/50',
    };
  }
  if (lowerCategory.includes('magic') || lowerCategory.includes('ma thuật')) {
    return {
      gradient: 'bg-gradient-to-r from-purple-500 via-violet-600 to-indigo-700',
      shadow: 'shadow-purple-500/50',
    };
  }
  if (lowerCategory.includes('basketball') || lowerCategory.includes('nba') || lowerCategory.includes('bóng rổ')) {
    return {
      gradient: 'bg-gradient-to-r from-orange-500 via-red-500 to-rose-600',
      shadow: 'shadow-orange-500/50',
    };
  }
  if (lowerCategory.includes('yugioh') || lowerCategory.includes('yu-gi-oh')) {
    return {
      gradient: 'bg-gradient-to-r from-amber-400 via-yellow-500 to-red-500',
      shadow: 'shadow-amber-500/50',
    };
  }
  if (lowerCategory.includes('one piece')) {
    return {
      gradient: 'bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500',
      shadow: 'shadow-orange-500/50',
    };
  }
  if (lowerCategory.includes('f1') || lowerCategory.includes('formula')) {
    return {
      gradient: 'bg-gradient-to-r from-red-600 via-red-500 to-rose-500',
      shadow: 'shadow-red-500/50',
    };
  }
  if (lowerCategory.includes('baseball')) {
    return {
      gradient: 'bg-gradient-to-r from-red-500 via-rose-600 to-pink-600',
      shadow: 'shadow-red-500/50',
    };
  }
  // Default style
  return {
    gradient: 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600',
    shadow: 'shadow-blue-500/50',
  };
};

/** Format price directly in VND without conversion */
const formatVnd = (price: number | null | undefined): string => {
  if (price === null || price === undefined) return '-';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
};

interface CardItemProps {
  card: CardType;
  layout?: 'grid' | 'list';
  onBuyClick?: (card: CardType) => void;
  onOfferClick?: (card: CardType) => void;
  onAddToCart?: (card: CardType) => void;
  showGhnReadiness?: boolean;
}

export const CardItem = React.memo(function CardItem({ card, layout = 'grid', onBuyClick, onOfferClick, onAddToCart, showGhnReadiness = true }: CardItemProps) {
  const { t, locale } = useLocalization();
  const { formatPrice } = useCurrency();
  const { setOpen } = useAuthModal();
  const { user } = useUser();
  const router = useRouter();

  /** Use direct VND format for marketplace listings, otherwise use currency conversion */
  const displayPrice = (price: number | null | undefined) => {
    if (card.priceIsVnd) return formatVnd(price);
    return formatPrice(price ?? 0);
  };

  // Check if current user is the owner of this card
  const isOwner = user?.id === card.sellerId;

  const handleActionClick = () => {
    if (!isOwner && onBuyClick && card.listingType === 'sale' && card.status !== 'sold') {
      onBuyClick(card);
    } else {
      router.push(`/cards/${card.id}`);
    }
  };

  const handleManageClick = () => {
    router.push(`/sell/edit/${card.id}`);
  };

  const copy = locale === 'ja-JP'
    ? {
        yourListing: 'あなたの出品',
        manage: '編集',
        soldPrice: '販売価格',
        viewDetails: '詳細を見る',
        acceptsOffers: 'オファー受付中',
        makeOffer: '価格交渉',
        viewOfferHistory: '提案履歴',
        addToCart: 'カートに追加',
        sold: '販売済み',
        bundle: 'セット {count}枚',
        sellerOnCardVerse: '販売者評価',
        newSeller: '新規販売者',
        positive: '高評価',
        itemsSold: '件販売済み',
        type: '種類',
        quantity: '数量',
        available: '在庫あり',
        payment: '支払い',
        shipping: '配送',
        ghnReady: 'GHN対応',
        price: '価格',
        lastSold: '直近販売',
        protected: 'CardVerse保護',
        grading: 'グレード',
        cardNumber: 'カード番号',
        language: '言語',
        season: 'シーズン',
        noOffers: 'オファー不可',
      }
    : locale === 'vi-VN'
      ? {
          yourListing: 'Bài đăng của bạn',
          manage: 'Chỉnh sửa',
          soldPrice: 'Giá đã bán',
          viewDetails: 'Xem chi tiết',
          acceptsOffers: 'Nhận offer',
          makeOffer: 'Trả giá',
          viewOfferHistory: 'Lịch sử offer',
          addToCart: 'Thêm vào giỏ hàng',
          sold: 'Đã bán',
          bundle: 'Combo {count} thẻ',
          sellerOnCardVerse: 'Độ uy tín người bán',
          newSeller: 'Người bán mới',
          positive: 'uy tín',
          itemsSold: 'đã bán',
          type: 'Loại',
          quantity: 'Số lượng',
          available: 'có sẵn',
          payment: 'Thanh toán',
          shipping: 'Vận chuyển',
          ghnReady: 'Sẵn sàng GHN',
          price: 'Giá',
          lastSold: 'Đã bán gần nhất',
          protected: 'CardVerse bảo vệ',
          grading: 'Grading',
          cardNumber: 'Số thẻ',
          language: 'Ngôn ngữ',
          season: 'Mùa giải',
          noOffers: 'Không nhận offer',
        }
      : {
          yourListing: 'Your listing',
          manage: 'Edit',
          soldPrice: 'Sold price',
          viewDetails: 'View details',
          acceptsOffers: 'Accepts offers',
          makeOffer: 'Make offer',
          viewOfferHistory: 'Offer history',
          addToCart: 'Add to cart',
          sold: 'Sold',
          bundle: 'Bundle {count} cards',
          sellerOnCardVerse: 'Seller reputation',
          newSeller: 'New seller',
          positive: 'positive',
          itemsSold: 'sold',
          type: 'Type',
          quantity: 'Qty',
          available: 'available',
          payment: 'Payment',
          shipping: 'Ship',
          ghnReady: 'GHN ready',
          price: 'Price',
          lastSold: 'Last sold',
          protected: 'CardVerse protected',
          grading: 'Grading',
          cardNumber: 'Card no.',
          language: 'Language',
          season: 'Season',
          noOffers: 'No offers',
        };

  const handleDetailClick = () => {
    router.push(`/cards/${card.id}`);
  };

  const handleOfferClick = () => {
    if (!user) {
      setOpen(true);
      return;
    }
    onOfferClick?.(card);
  };

  const handleAddToCart = () => {
    if (!user) {
      setOpen(true);
      return;
    }
    onAddToCart?.(card);
  };

  const images = React.useMemo(
    () => Array.from(new Set([card.imageUrl, ...(card.imageUrls || [])].filter(Boolean))),
    [card.imageUrl, card.imageUrls]
  );
  const [activeImageIndex, setActiveImageIndex] = React.useState(0);

  React.useEffect(() => {
    setActiveImageIndex(0);
  }, [card.id, images.length]);

  React.useEffect(() => {
    if (layout !== 'list' || images.length < 2) return;

    const intervalId = window.setInterval(() => {
      setActiveImageIndex((current) => (current + 1) % images.length);
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, [images.length, layout]);

  const activeImage = images[activeImageIndex] || card.imageUrl;

  const sellerStatsText = React.useMemo(() => {
    const rating = card.sellerRating;
    const soldCount = card.sellerReviewCount ?? 0;
    const ratingText = typeof rating === 'number' && rating > 0
      ? `${rating.toFixed(1)}% ${copy.positive}`
      : copy.newSeller;

    return `${ratingText} · ${soldCount} ${copy.itemsSold}`;
  }, [card.sellerRating, card.sellerReviewCount, copy.itemsSold, copy.newSeller, copy.positive]);

  const showPreviousImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setActiveImageIndex((current) => (current - 1 + images.length) % images.length);
  };

  const showNextImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setActiveImageIndex((current) => (current + 1) % images.length);
  };

  // Buyer can negotiate when the seller allows offers (active sale, not owner).
  const canOffer =
    !!onOfferClick &&
    !isOwner &&
    card.listingType === 'sale' &&
    card.status !== 'sold' &&
    !!card.acceptOffers;
  const offerActionLabel = card.buyerOfferStatus ? copy.viewOfferHistory : copy.makeOffer;

  const getBadgeVariant = (condition?: string) => {
    if (!condition) return 'outline';
    const lowerCaseCondition = condition.toLowerCase();
    if (lowerCaseCondition.includes('mint') || lowerCaseCondition.includes('hoàn hảo') || lowerCaseCondition.includes('psa 10') || lowerCaseCondition.includes('psa 9')) {
      return 'default';
    }
    if (lowerCaseCondition.includes('near mint') || lowerCaseCondition.includes('gần như mới') || lowerCaseCondition.includes('excellent') || lowerCaseCondition.includes('tuyệt vời')) {
      return 'secondary';
    }
    return 'outline';
  };

  const renderPriceInfo = () => {
    // If user is the owner, show manage button instead of buy/bid
    if (isOwner) {
      return (
        <div className="flex flex-col items-center gap-0.5 sm:gap-1 w-full">
          <div className="text-base sm:text-lg md:text-xl font-bold text-primary">
            {card.listingType === 'sale' && card.price ? displayPrice(card.price) :
              card.listingType === 'auction' && card.currentBid ? displayPrice(card.currentBid) :
                card.listingType === 'razz' && card.ticketPrice ? displayPrice(card.ticketPrice) : 'N/A'}
          </div>
          <span className="text-xs text-muted-foreground mb-1">{copy.yourListing}</span>
          <Button
            size="sm"
            variant="secondary"
            className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9"
            onClick={handleManageClick}
          >
            <Pencil className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
            {copy.manage}
          </Button>
        </div>
      );
    }

    switch (card.listingType) {
      case 'sale':
        // Show sold price if card is sold
        if (card.status === 'sold') {
          return (
            <div className="flex flex-col items-end gap-0.5 sm:gap-1 w-full">
              <div className="text-xs text-muted-foreground">{copy.soldPrice}</div>
              <div className="text-base sm:text-lg md:text-xl font-bold text-green-500 flex items-center gap-1 sm:gap-2">
                {card.lastSoldPrice ? displayPrice(card.lastSoldPrice) : displayPrice(card.price || 0)}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9"
                onClick={handleActionClick}
              >
                {copy.viewDetails}
              </Button>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-end gap-0.5 sm:gap-1 w-full">
            <div className="text-base sm:text-lg md:text-xl font-bold text-primary flex items-center gap-1 sm:gap-2">
              <Tag className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5 text-muted-foreground" />
              {card.price ? displayPrice(card.price) : 'N/A'}
            </div>
            {card.acceptOffers && (
              <span className="text-[10px] text-amber-500 font-medium">{copy.acceptsOffers}</span>
            )}
            <Button size="sm" aria-label={`Buy ${card.name} now`} className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9" onClick={handleActionClick}>{t('card_item_buy_now')}</Button>
            {canOffer && (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Make an offer for ${card.name}`}
                className="w-full text-xs sm:text-sm h-7 sm:h-8 md:h-9 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
                onClick={handleOfferClick}
              >
                <HandCoins className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                {offerActionLabel}
              </Button>
            )}
          </div>
        );
      case 'auction':
        return (
          <div className="flex flex-col items-end gap-0.5 sm:gap-1 text-right w-full">
            <div className="text-sm sm:text-base md:text-lg font-bold text-primary">{card.currentBid ? displayPrice(card.currentBid) : 'N/A'}</div>
            <span className="text-xs sm:text-sm text-muted-foreground hidden sm:block">{t('card_item_current_bid')}</span>
            {card.auctionEnds && (
              <div className="flex items-center text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
                <span className="hidden sm:inline">{t('card_item_ends_in').replace('{time}', formatDistanceToNow(new Date(card.auctionEnds)))}</span>
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 sm:ml-2" />
              </div>
            )}
            <Button size="sm" className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9" aria-label={`Place bid for ${card.name}`} onClick={handleActionClick}><Hammer className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />{t('card_item_place_bid')}</Button>
          </div>
        );
      case 'razz':
        const progress = ((card.razzEntries ?? 0) / (card.totalTickets ?? 1)) * 100;
        return (
          <div className="w-full space-y-1 sm:space-y-2 text-right">
            <span className="text-sm sm:text-base md:text-lg font-bold text-primary">{card.ticketPrice ? t('card_item_ticket_price').replace('{price}', displayPrice(card.ticketPrice)) : 'N/A'}</span>
            <div>
              <Progress value={progress} className="h-1.5 sm:h-2" />
              <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                <span>{card.razzEntries ?? 0}/{card.totalTickets ?? 0}</span>
              </div>
            </div>
            <Button size="sm" className="w-full text-xs sm:text-sm h-7 sm:h-8 md:h-9" aria-label={`Buy ticket for ${card.name}`} onClick={handleActionClick}><Ticket className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />{t('card_item_buy_ticket')}</Button>
          </div>
        );
    }
  };

  if (layout === 'list') {
    const catStyle = getCategoryStyle(card.category);
    const listTitleSize = card.name.length > 110
      ? 'text-base md:text-lg'
      : card.name.length > 70
        ? 'text-lg md:text-xl'
        : 'text-xl md:text-2xl';
    return (
      <Card
        className={`group relative flex w-full flex-col overflow-hidden rounded-lg border bg-gradient-to-br from-card via-card to-card/50 transition-all duration-300 md:flex-row
          ${card.status === 'sold'
            ? 'border-green-500/40 opacity-80'
            : 'border-border/60 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_10px_40px_-12px_hsl(var(--primary)/0.35)]'}`}
      >
        {/* Left accent rail — grows in on hover */}
        {card.status !== 'sold' && (
          <span className="pointer-events-none absolute left-0 top-0 z-10 h-full w-[3px] origin-top scale-y-0 bg-gradient-to-b from-primary via-primary/70 to-transparent transition-transform duration-300 group-hover:scale-y-100" />
        )}

        {/* Image — the "display case" frame */}
        <div
          className="relative w-full shrink-0 cursor-pointer overflow-hidden bg-black/25 md:w-56 lg:w-64"
          onClick={handleDetailClick}
          role="link"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleDetailClick();
            }
          }}
        >
          <div className="relative aspect-[3/4] w-full md:h-full">
            <Image
              src={optimizeCloudinaryUrl(activeImage, 500)}
              alt={card.name}
              data-ai-hint={card.imageHint || 'trading card'}
              fill
              sizes="(max-width: 768px) 100vw, 16rem"
              className={`object-contain p-2 transition-transform duration-500 ${card.status === 'sold' ? 'grayscale' : 'group-hover:scale-[1.02]'}`}
            />
            {/* depth / blend into card body */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-card/40" />
            {/* category chip */}
            <div className={`absolute left-2.5 top-2.5 rounded-md border border-white/20 ${catStyle.gradient} px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg ${catStyle.shadow}`}>
              {getCategoryCode(card.category)}
            </div>
            {/* sold overlay */}
            {card.status === 'sold' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <span className="rounded-lg bg-green-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                  {copy.sold}
                </span>
              </div>
            )}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow transition hover:bg-background"
                  onClick={showPreviousImage}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow transition hover:bg-background"
                  onClick={showNextImage}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1">
                  {images.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      aria-label={`Show image ${index + 1}`}
                      className={`h-1.5 rounded-full transition-all ${activeImageIndex === index ? 'w-5 bg-primary' : 'w-1.5 bg-white/60 hover:bg-white'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveImageIndex(index);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-stretch">
          <div className="flex min-w-0 flex-col">
            {(card.status === 'sold' || card.isBundle) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {card.status === 'sold' && (
                  <Badge className="rounded-md bg-green-500 text-[10px] text-white">{copy.sold}</Badge>
                )}
                {card.isBundle && (
                  <Badge variant="outline" className="rounded-md border-violet-500/50 text-[10px] text-violet-400">
                    {copy.bundle.replace('{count}', String(card.bundleItems?.length || 0))}
                  </Badge>
                )}
              </div>
            )}

            <h3
              className={`line-clamp-2 cursor-pointer break-words font-semibold leading-snug tracking-normal hover:text-primary [overflow-wrap:anywhere] ${listTitleSize}`}
              onClick={handleDetailClick}
              title={card.name}
            >
              {card.name}
            </h3>

            <p className="mt-1.5 text-sm text-muted-foreground">
              {card.condition || 'Pre-owned'}
              {card.publisher && <span> · {card.publisher}</span>}
              {card.setName && <span> · {card.setName}</span>}
            </p>

            {(() => {
              const specs = [
                (card.gradingCompany || card.grade != null) && {
                  label: copy.grading,
                  value: [card.gradingCompany, card.grade].filter((v) => v != null && v !== '').join(' ') || '—',
                },
                card.cardNumber && { label: copy.cardNumber, value: card.cardNumber },
                card.language && { label: copy.language, value: card.language },
                card.season && { label: copy.season, value: card.season },
                { label: copy.quantity, value: `${card.quantity || 1} ${copy.available}` },
                card.lastSoldPrice && { label: copy.lastSold, value: displayPrice(card.lastSoldPrice) },
              ].filter(Boolean) as { label: string; value: string }[];
              return (
                <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-4 border-t border-border/40 pt-5">
                  {specs.map((s, i) => (
                    <div key={i} className="flex flex-col">
                      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground/60">{s.label}</dt>
                      <dd className="mt-1 text-[0.95rem] font-semibold text-foreground">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}

            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-6 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                {copy.protected}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <HandCoins className="h-3.5 w-3.5 shrink-0" />
                PayOS / Wallet
              </span>
              {showGhnReadiness && (
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                  {copy.ghnReady}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4 border-t border-border/50 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="flex min-w-0 items-center gap-3">
              {card.sellerAvatar ? (
                <Image src={card.sellerAvatar} alt={card.sellerName || ''} width={42} height={42} className="rounded-full object-cover ring-1 ring-border" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/30">
                  <span className="text-base font-bold text-primary">{(card.sellerName || card.author || 'C').charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{card.sellerName || card.author}</p>
                <p className="truncate text-xs text-muted-foreground">{sellerStatsText}</p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-500/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.price}</span>
                {card.acceptOffers ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                    <HandCoins className="h-3 w-3" />
                    {copy.acceptsOffers}
                  </span>
                ) : (
                  <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-400/90">
                    {copy.noOffers}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-lg font-bold leading-none text-amber-500 md:text-xl">
                {card.listingType === 'sale' && card.price ? displayPrice(card.price) : 'N/A'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {isOwner ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-11 rounded-lg px-4 text-sm font-bold"
                  onClick={handleManageClick}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  {copy.manage}
                </Button>
              ) : (
                <Button
                  size="sm"
                  aria-label={`Buy ${card.name} now`}
                  className="h-11 rounded-lg bg-primary px-4 text-sm font-bold"
                  onClick={handleActionClick}
                  disabled={card.status === 'sold'}
                >
                  <Tag className="mr-1.5 h-4 w-4" />
                  {card.listingType === 'sale' ? t('card_item_buy_now') :
                    card.listingType === 'auction' ? t('card_item_place_bid') :
                      t('card_item_buy_ticket')}
                </Button>
              )}
              {canOffer ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Make an offer for ${card.name}`}
                  className="h-11 rounded-lg border-amber-500/70 text-sm font-bold text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                  onClick={handleOfferClick}
                >
                  <HandCoins className="mr-1.5 h-4 w-4" />
                  {offerActionLabel}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 rounded-lg text-sm font-bold"
                  onClick={handleDetailClick}
                >
                  {copy.viewDetails}
                </Button>
              )}
              {!isOwner && card.status !== 'sold' && onAddToCart && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Add ${card.name} to cart`}
                  className="h-11 rounded-lg border-emerald-500/50 text-sm font-bold text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                  onClick={handleAddToCart}
                >
                  <ShoppingCart className="mr-1.5 h-4 w-4" />
                  {copy.addToCart}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // Default grid layout - vertical card matching reference design
  return (
    <Card className={`overflow-hidden flex flex-col bg-card/80 hover:bg-card transition-all duration-300 group rounded-2xl sm:rounded-3xl border shadow-lg hover:shadow-xl ${card.status === 'sold' ? 'border-green-500/50 opacity-75' : 'border-gray-700/50'}`}>
      {/* Image section */}
      <div
        className="relative aspect-square overflow-hidden img-shimmer cursor-pointer"
        onClick={handleDetailClick}
        role="link"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleDetailClick();
          }
        }}
      >
        <Image
          src={optimizeCloudinaryUrl(card.imageUrl, 400)}
          alt={card.name}
          data-ai-hint={card.imageHint || 'trading card'}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          loading="lazy"
          className={`object-cover transition-transform duration-500 ${card.status === 'sold' ? 'grayscale' : 'group-hover:scale-105'}`}
        />
        {/* Sold overlay */}
        {card.status === 'sold' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-green-500 text-white font-bold px-4 py-2 rounded-lg text-sm uppercase tracking-wider">
              {copy.sold}
            </span>
          </div>
        )}
        {/* Condition badge - top left */}
        {card.condition && (
          <Badge
            variant="secondary"
            className="absolute top-2 sm:top-3 left-2 sm:left-3 bg-white/90 text-black text-[10px] sm:text-xs font-medium backdrop-blur-sm"
          >
            {card.condition}
          </Badge>
        )}
        {/* Category badge - top right - Professional Style */}
        {(() => {
          const style = getCategoryStyle(card.category);
          return (
            <div className={`
              absolute top-2 sm:top-3 right-2 sm:right-3
              ${style.gradient}
              text-white
              text-[9px] sm:text-[10px]
              font-bold
              px-2 sm:px-2.5
              py-0.5 sm:py-1
              rounded-md
              shadow-lg ${style.shadow}
              border border-white/20
            `}>
              <span className="uppercase tracking-wide">{getCategoryCode(card.category)}</span>
            </div>
          );
        })()}
      </div>

      {/* Content section */}
      <div className="p-3 sm:p-4 md:p-5 flex flex-col flex-grow">
        {/* Title */}
        <h3
          className="font-bold text-sm sm:text-base md:text-lg lg:text-xl line-clamp-1 mb-1 cursor-pointer hover:text-primary"
          onClick={handleDetailClick}
        >
          {card.name}
        </h3>

        {/* Category & details */}
        <p className="text-xs sm:text-sm text-muted-foreground mb-1">
          {card.category}
          {card.setName && <span className="text-muted-foreground/60"> · {card.setName}</span>}
        </p>

        {/* Seller info */}
        <div className="flex items-center gap-1.5 mb-1 sm:mb-2">
          {card.sellerAvatar ? (
            <Image src={card.sellerAvatar} alt={card.sellerName || ''} width={16} height={16} className="rounded-full object-cover" />
          ) : (
            <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center">
              <User className="h-2.5 w-2.5 text-muted-foreground" />
            </div>
          )}
          <span className="text-[11px] sm:text-xs text-muted-foreground/80 truncate">{card.sellerName || card.author}</span>
        </div>

        {/* Footer with price and button */}
        <div className="flex flex-col items-center mt-auto pt-3 sm:pt-4 border-t border-border/30 gap-2 sm:gap-3">
          {/* Price - centered on top */}
          <span className="font-bold text-base sm:text-lg md:text-xl text-primary">
            {card.listingType === 'sale' && card.price ? displayPrice(card.price) :
              card.listingType === 'auction' && card.currentBid ? displayPrice(card.currentBid) :
                card.listingType === 'razz' && card.ticketPrice ? displayPrice(card.ticketPrice) : 'N/A'}
          </span>

          {isOwner ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleManageClick}
              className="rounded-full px-4 sm:px-6 py-2 sm:py-2.5 h-auto text-xs sm:text-sm font-medium gap-1 sm:gap-2 w-full justify-center"
            >
              <Pencil className="h-3.5 w-3.5" />
              {copy.manage}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleActionClick}
                className="rounded-full px-4 sm:px-6 py-2 sm:py-2.5 h-auto text-xs sm:text-sm font-medium gap-1 sm:gap-2 w-full justify-center"
              >
                {card.listingType === 'sale' ? t('card_item_buy_now') :
                  card.listingType === 'auction' ? t('card_item_place_bid') :
                    t('card_item_buy_ticket')}
                <span className="bg-white/20 rounded-full p-0.5 sm:p-1">
                  <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7v10" />
                  </svg>
                </span>
              </Button>
              {card.status !== 'sold' && onAddToCart && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddToCart}
                  className="rounded-full px-4 sm:px-6 py-2 sm:py-2.5 h-auto text-xs sm:text-sm font-medium gap-1 sm:gap-2 w-full justify-center border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {copy.addToCart}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
});
