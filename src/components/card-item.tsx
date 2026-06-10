
"use client";

import React from "react";
import type { Card as CardType } from "@/lib/types";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, Tag, Ticket, Hammer, Zap, Sparkles, Target, Trophy, Star, Gem, Crown, Settings, User, HandCoins } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocalization } from "@/context/localization-context";
import { useCurrency } from "@/contexts/currency-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useRouter } from "next/navigation";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";

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
}

export const CardItem = React.memo(function CardItem({ card, layout = 'grid', onBuyClick, onOfferClick }: CardItemProps) {
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
    if (onBuyClick && card.listingType === 'sale' && card.status !== 'sold') {
      onBuyClick(card);
    } else {
      router.push(`/cards/${card.id}`);
    }
  };

  const handleManageClick = () => {
    // Navigate to card details/manage page
    router.push(`/cards/${card.id}`);
  };

  const copy = locale === 'ja-JP'
    ? {
        yourListing: 'あなたの出品',
        manage: '管理',
        soldPrice: '販売価格',
        viewDetails: '詳細を見る',
        acceptsOffers: 'オファー受付中',
        makeOffer: '価格交渉',
        sold: '販売済み',
        bundle: 'セット {count}枚',
      }
    : locale === 'vi-VN'
      ? {
          yourListing: 'Bài đăng của bạn',
          manage: 'Quản lý',
          soldPrice: 'Giá đã bán',
          viewDetails: 'Xem chi tiết',
          acceptsOffers: 'Nhận offer',
          makeOffer: 'Trả giá',
          sold: 'Đã bán',
          bundle: 'Combo {count} thẻ',
        }
      : {
          yourListing: 'Your listing',
          manage: 'Manage',
          soldPrice: 'Sold price',
          viewDetails: 'View details',
          acceptsOffers: 'Accepts offers',
          makeOffer: 'Make offer',
          sold: 'Sold',
          bundle: 'Bundle {count} cards',
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

  // Buyer can negotiate when the seller allows offers (active sale, not owner).
  const canOffer =
    !!onOfferClick &&
    !isOwner &&
    card.listingType === 'sale' &&
    card.status !== 'sold' &&
    !!card.acceptOffers;

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
            <Settings className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
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
                {copy.makeOffer}
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
    return (
      <Card
        className={`group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-card/50 transition-all duration-300 md:flex-row
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
          className="relative w-full shrink-0 cursor-pointer overflow-hidden md:w-40 lg:w-48"
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
              src={optimizeCloudinaryUrl(card.imageUrl, 400)}
              alt={card.name}
              data-ai-hint={card.imageHint || 'trading card'}
              fill
              sizes="(max-width: 768px) 100vw, 12rem"
              className={`object-cover transition-transform duration-500 ${card.status === 'sold' ? 'grayscale' : 'group-hover:scale-[1.06]'}`}
            />
            {/* depth / blend into card body */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-card/40" />
            {/* category chip */}
            <div className={`absolute left-2.5 top-2.5 rounded-md border border-white/20 ${catStyle.gradient} px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg ${catStyle.shadow}`}>
              {card.category.slice(0, 3)}
            </div>
            {/* sold overlay */}
            {card.status === 'sold' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <span className="rounded-lg bg-green-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                  {copy.sold}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-stretch md:gap-5">
          {/* Info column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="line-clamp-2 cursor-pointer text-lg font-bold leading-tight tracking-tight hover:text-primary md:line-clamp-1 md:text-xl"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
                onClick={handleDetailClick}
              >
                {card.name}
              </h3>
              {card.status === 'sold' && (
                <Badge className="bg-green-500 text-[10px] text-white">Đã bán</Badge>
              )}
              {card.isBundle && (
                <Badge variant="outline" className="border-violet-500/50 text-[10px] text-violet-400">
                  {copy.bundle.replace('{count}', String(card.bundleItems?.length || 0))}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{card.category}</p>

            {/* meta chips */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {card.condition && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  <Gem className="h-3 w-3" />
                  {card.condition}
                </span>
              )}
              {card.publisher && (
                <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                  {card.publisher}
                </span>
              )}
              {card.setName && (
                <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                  {card.setName}
                </span>
              )}
            </div>

            {/* Seller info pinned to bottom */}
            <div className="mt-auto flex items-center gap-2 pt-4">
              {card.sellerAvatar ? (
                <Image src={card.sellerAvatar} alt={card.sellerName || ''} width={22} height={22} className="rounded-full object-cover ring-1 ring-border" />
              ) : (
                <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted ring-1 ring-border">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              <span className="truncate text-xs text-muted-foreground">{card.sellerName || card.author}</span>
            </div>
          </div>

          {/* Price / action panel — separated like a display-case tag */}
          <div className="flex shrink-0 flex-col justify-center border-t border-border/50 pt-4 md:w-44 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            {renderPriceInfo()}
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
              <span className="uppercase tracking-wide">{card.category.slice(0, 3)}</span>
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

          {/* Buy Now button with arrow - below price */}
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
        </div>
      </div>
    </Card>
  );
});
