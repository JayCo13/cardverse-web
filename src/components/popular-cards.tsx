"use client";

import React, { useEffect, useState } from "react";
import Autoplay from "embla-carousel-autoplay";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { useLocalization } from "@/context/localization-context";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Crown, Trophy, Anchor, Sparkle } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { getHighResImageUrl } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/contexts/currency-context";
import { Badge } from "@/components/ui/badge";

interface ExpensiveCard {
  id: string | number;
  name: string;
  imageUrl: string;
  setName: string;
  price: number;
  category: 'pokemon' | 'soccer' | 'onepiece';
  rarity?: string;
  url?: string;
}

export function PopularCards() {
  const { t } = useLocalization();
  const router = useRouter();
  const [cards, setCards] = useState<ExpensiveCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { formatPrice, currency } = useCurrency();

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  useEffect(() => {
    const fetchTopExpensiveCards = async () => {
      try {
        // Fetch Pokemon (top 4)
        const pokemonRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=in.(3,85)&image_url=not.is.null&market_price=not.is.null&market_price=gt.50&order=market_price.desc&select=product_id,name,image_url,set_name,rarity,market_price&limit=4`,
          { headers: { 'apikey': SUPABASE_KEY } }
        );
        const pokemonData = pokemonRes.ok ? await pokemonRes.json() : [];

        // Fetch One Piece (top 4)
        const onepieceRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=eq.68&image_url=not.is.null&market_price=not.is.null&market_price=gt.10&order=market_price.desc&select=product_id,name,image_url,set_name,rarity,market_price&limit=4`,
          { headers: { 'apikey': SUPABASE_KEY } }
        );
        const onepieceData = onepieceRes.ok ? await onepieceRes.json() : [];

        // Fetch Soccer (top 4)
        const soccerRes = await fetch(
          `${SUPABASE_URL}/rest/v1/crawled_cards?category=ilike.*Soccer*&image_url=not.is.null&price=gt.0&order=price.desc&select=id,name,image_url,set_name,price,year&limit=4`,
          { headers: { 'apikey': SUPABASE_KEY } }
        );
        const soccerData = soccerRes.ok ? await soccerRes.json() : [];

        // Map to unified format
        const mappedCards: ExpensiveCard[] = [
          ...pokemonData.map((c: any) => ({
            id: c.product_id,
            name: c.name,
            imageUrl: getHighResImageUrl(c.image_url),
            setName: c.set_name || 'Pokemon',
            price: c.market_price,
            category: 'pokemon' as const,
            rarity: c.rarity,
          })),
          ...onepieceData.map((c: any) => ({
            id: c.product_id,
            name: c.name,
            imageUrl: c.image_url,
            setName: c.set_name || 'One Piece',
            price: c.market_price,
            category: 'onepiece' as const,
            rarity: c.rarity,
          })),
          ...soccerData.map((c: any) => ({
            id: c.id,
            name: c.name,
            imageUrl: c.image_url,
            setName: c.set_name || c.year || 'Soccer',
            price: c.price,
            category: 'soccer' as const,
          })),
        ];

        // Sort by price descending and take top 12
        mappedCards.sort((a, b) => b.price - a.price);
        setCards(mappedCards.slice(0, 12));
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching top expensive cards:', err);
        setIsLoading(false);
      }
    };

    fetchTopExpensiveCards();
  }, [SUPABASE_KEY, SUPABASE_URL]);

  const plugin = React.useRef(
    Autoplay({ delay: 3000, stopOnInteraction: false, stopOnMouseEnter: false })
  );

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'pokemon': return <Sparkle className="w-3 h-3" weight="fill" />;
      case 'soccer': return <Trophy className="w-3 h-3" />;
      case 'onepiece': return <Anchor className="w-3 h-3" />;
      default: return null;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'pokemon': return 'bg-yellow-500';
      case 'soccer': return 'bg-green-500';
      case 'onepiece': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getCategoryGlow = (category: string) => {
    switch (category) {
      case 'pokemon': return 'shadow-yellow-500';
      case 'soccer': return 'shadow-green-500';
      case 'onepiece': return 'shadow-red-500';
      default: return 'shadow-gray-500';
    }
  };

  // For soccer cards, apply VND /2 discount
  const getDisplayPrice = (card: ExpensiveCard) => {
    if (card.category === 'soccer' && currency === 'VND') {
      return formatPrice(card.price / 2);
    }
    return formatPrice(card.price);
  };

  const renderCarouselContent = () => {
    if (isLoading) {
      return [...Array(6)].map((_, index) => (
        <CarouselItem key={index} className="basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6">
          <div className="p-1 h-full">
            <Card className="overflow-hidden h-full flex flex-col group">
              <Skeleton className="aspect-[3/4] w-full" />
            </Card>
          </div>
        </CarouselItem>
      ));
    }

    if (cards.length > 0) {
      return cards.map((card, index) => (
        <CarouselItem key={`${card.category}-${card.id}`} className="basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6">
          <div className="p-3 sm:p-4 h-full">
            <div className="animated-border-card h-full">
              <Card className="card-inner overflow-hidden h-full flex flex-col group border-0 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer bg-card">
                <div className="aspect-[3/4] relative">
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Category badge - Tech Pill Style */}
                  <div className={`absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10 bg-black/60 shadow-xl group-hover:bg-black/80 transition-all duration-300 group-hover:border-white/20`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${getCategoryColor(card.category)} ${getCategoryGlow(card.category)} shadow-[0_0_8px] box-content border border-white/20`}></div>
                    <span className="text-[10px] sm:text-xs font-bold text-white tracking-widest uppercase opacity-90" style={{ fontFamily: "'Quantico', sans-serif" }}>
                      {card.category === 'onepiece' ? 'ONE PIECE' : card.category}
                    </span>
                  </div>

                  {/* Rank badge - Hexagon Style */}
                  <div className="absolute top-3 right-4 z-20">
                    <div className="relative w-10 h-12 flex items-center justify-center filter drop-shadow-lg">
                      {/* Background Hexagon */}
                      <div
                        className={`absolute inset-0 ${index === 0 ? 'bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700' : index === 1 ? 'bg-gradient-to-b from-gray-200 via-gray-400 to-gray-600' : index === 2 ? 'bg-gradient-to-b from-orange-300 via-orange-500 to-orange-800' : 'bg-gradient-to-b from-slate-700 to-slate-900'} shadow-inner`}
                        style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                      ></div>

                      {/* Inner Dark Hexagon */}
                      <div
                        className="absolute inset-[2px] bg-black/90 backdrop-blur-sm"
                        style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                      ></div>

                      {/* Rank Number */}
                      <div className="relative z-10 flex flex-col items-center justify-center -mt-1">
                        <span className={`text-[8px] mt-1 font-bold uppercase tracking-wider ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-gray-400' : index === 2 ? 'text-orange-500' : 'text-slate-500'}`} style={{ fontFamily: "'Quantico', sans-serif" }}>RANK</span>
                        <span className={`text-lg font-bold leading-none ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-white' : index === 2 ? 'text-orange-400' : 'text-sky-300'}`} style={{ fontFamily: "'Orbitron', sans-serif" }}>
                          {index + 1}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 text-white" style={{ fontFamily: "'Quantico', sans-serif" }}>
                    <h3 className="font-bold text-base sm:text-lg mb-1 line-clamp-2 drop-shadow-lg">
                      {card.name}
                    </h3>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] sm:text-xs bg-white/20 backdrop-blur-sm rounded px-2 py-1">
                        {card.setName?.slice(0, 20)}
                      </span>
                      <span className="text-lg sm:text-xl font-bold text-primary drop-shadow-lg">
                        {getDisplayPrice(card)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </CarouselItem>
      ));
    }

    return (
      <CarouselItem className="basis-full">
        <div className="text-center py-10">
          <p className="text-white/50">No cards found</p>
        </div>
      </CarouselItem>
    );
  };

  return (
    <section id="popular-cards" className="py-16 md:py-24 bg-transparent">
      <div className="container mx-auto px-4">
        <div className="flex justify-center items-center gap-4 mb-12">
          <div className="relative w-12 h-12 md:w-16 md:h-16">
            <Image
              src="/assets/top-logo.png"
              alt="Top Expensive Cards Logo"
              fill
              className="object-contain drop-shadow-lg"
            />
          </div>
          <div className="relative">
            <h2 className="text-2xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-orange-400 to-yellow-500 font-headline tracking-wider mb-2 drop-shadow-md text-center">
              {t('top_expensive_cards')}
            </h2>
          </div>
        </div>
        <Carousel
          plugins={[plugin.current]}
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full"
        >
          <CarouselContent>
            {renderCarouselContent()}
          </CarouselContent>
        </Carousel>
      </div>
    </section >
  );
}

export default PopularCards;
