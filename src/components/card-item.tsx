
"use client";

import React from "react";
import type { Card as CardType } from "@/lib/types";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, Tag, Ticket, Hammer, Zap, Sparkles, Target, Trophy, Star, Gem, Crown, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocalization } from "@/context/localization-context";
import { useCurrency } from "@/contexts/currency-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useRouter } from "next/navigation";

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

interface CardItemProps {
  card: CardType;
  layout?: 'grid' | 'list';
}

export const CardItem = React.memo(function CardItem({ card, layout = 'grid' }: CardItemProps) {
  const { t } = useLocalization();
  const { formatPrice } = useCurrency();
  const { setOpen } = useAuthModal();
  const { user } = useUser();
  const router = useRouter();

  // Check if current user is the owner of this card
  const isOwner = user?.id === card.sellerId;

  const handleActionClick = () => {
    // Navigate to card details page
    router.push(`/cards/${card.id}`);
  };

  const handleManageClick = () => {
    // Navigate to card details/manage page
    router.push(`/cards/${card.id}`);
  };

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
            {card.listingType === 'sale' && card.price ? formatPrice(card.price) :
              card.listingType === 'auction' && card.currentBid ? formatPrice(card.currentBid) :
                card.listingType === 'razz' && card.ticketPrice ? formatPrice(card.ticketPrice) : 'N/A'}
          </div>
          <span className="text-xs text-muted-foreground mb-1">Your Listing</span>
          <Button
            size="sm"
            variant="secondary"
            className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9"
            onClick={handleManageClick}
          >
            <Settings className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
            Manage
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
              <div className="text-xs text-muted-foreground">Giá đã bán</div>
              <div className="text-base sm:text-lg md:text-xl font-bold text-green-500 flex items-center gap-1 sm:gap-2">
                {card.lastSoldPrice ? formatPrice(card.lastSoldPrice) : formatPrice(card.price || 0)}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9"
                onClick={handleActionClick}
              >
                Xem chi tiết
              </Button>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-end gap-0.5 sm:gap-1 w-full">
            <div className="text-base sm:text-lg md:text-xl font-bold text-primary flex items-center gap-1 sm:gap-2">
              <Tag className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5 text-muted-foreground" />
              {card.price ? formatPrice(card.price) : 'N/A'}
            </div>
            <Button size="sm" aria-label={`Buy ${card.name} now`} className="w-full mt-1 sm:mt-2 text-xs sm:text-sm h-7 sm:h-8 md:h-9" onClick={handleActionClick}>{t('card_item_buy_now')}</Button>
          </div>
        );
      case 'auction':
        return (
          <div className="flex flex-col items-end gap-0.5 sm:gap-1 text-right w-full">
            <div className="text-sm sm:text-base md:text-lg font-bold text-primary">{card.currentBid ? formatPrice(card.currentBid) : 'N/A'}</div>
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
            <span className="text-sm sm:text-base md:text-lg font-bold text-primary">{card.ticketPrice ? t('card_item_ticket_price').replace('{price}', formatPrice(card.ticketPrice)) : 'N/A'}</span>
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
    return (
      <Card className={`overflow-hidden w-full flex flex-col md:flex-row bg-card/80 hover:bg-card transition-colors duration-300 group ${card.status === 'sold' ? 'border-green-500/50 opacity-75' : ''}`}>
        <div className="relative w-full md:w-1/5 aspect-square md:aspect-[3/4]">
          <Image
            src={card.imageUrl}
            alt={card.name}
            data-ai-hint={card.imageHint || 'trading card'}
            fill
            className={`object-cover ${card.status === 'sold' ? 'grayscale' : ''}`}
          />
          {/* Sold overlay */}
          {card.status === 'sold' && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="bg-green-500 text-white font-bold px-3 py-1 rounded-lg text-xs uppercase tracking-wider">
                Đã bán
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col md:flex-row p-4">
          <div className="flex-grow md:w-3/5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl mb-1">{card.name}</CardTitle>
              {card.status === 'sold' && (
                <Badge className="bg-green-500 text-white text-xs">Đã bán</Badge>
              )}
            </div>
            <CardDescription className="text-sm">{card.category}</CardDescription>
            {card.condition && (
              <div className="mt-2">
                <Badge variant={getBadgeVariant(card.condition)} className="self-start">{card.condition}</Badge>
              </div>
            )}
          </div>
          <div className="md:w-2/5 flex flex-col justify-center items-end mt-4 md:mt-0">
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
      <div className="relative aspect-square overflow-hidden">
        <Image
          src={card.imageUrl}
          alt={card.name}
          data-ai-hint={card.imageHint || 'trading card'}
          fill
          className={`object-cover transition-transform duration-500 ${card.status === 'sold' ? 'grayscale' : 'group-hover:scale-105'}`}
        />
        {/* Sold overlay */}
        {card.status === 'sold' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-green-500 text-white font-bold px-4 py-2 rounded-lg text-sm uppercase tracking-wider">
              Đã bán
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
        <h3 className="font-bold text-sm sm:text-base md:text-lg lg:text-xl line-clamp-1 mb-1">
          {card.name}
        </h3>

        {/* Category subtitle */}
        <p className="text-xs sm:text-sm text-muted-foreground mb-1 sm:mb-2">
          {card.category}
        </p>

        {/* Description - using author as description placeholder */}
        <p className="text-[11px] sm:text-xs md:text-sm text-muted-foreground/80 line-clamp-2 flex-grow">
          {card.listingType === 'sale' ? t('card_item_buy_now') : card.listingType === 'auction' ? t('card_item_place_bid') : t('card_item_buy_ticket')} - {card.author}
        </p>

        {/* Footer with price and button */}
        <div className="flex flex-col items-center mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border/30 gap-2 sm:gap-3">
          {/* Price - centered on top */}
          <span className="font-bold text-base sm:text-lg md:text-xl text-primary">
            {card.listingType === 'sale' && card.price ? formatPrice(card.price) :
              card.listingType === 'auction' && card.currentBid ? formatPrice(card.currentBid) :
                card.listingType === 'razz' && card.ticketPrice ? formatPrice(card.ticketPrice) : 'N/A'}
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
