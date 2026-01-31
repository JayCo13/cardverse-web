"use client";

import React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Sparkles } from "lucide-react";
import { useCurrency } from "@/contexts/currency-context";
import { StrawHatIcon } from "@/components/icons/onepiece-icons";

export interface OnePieceCard {
    product_id: number;
    name: string;
    image_url: string | null;
    set_name: string | null;
    number: string | null;
    rarity: string | null;
    market_price: number | null;
    low_price: number | null;
    tcgplayer_url: string | null;
}

interface OnePieceCardItemProps {
    card: OnePieceCard;
}

// Get rarity color
function getRarityColor(rarity: string | null): string {
    const r = rarity?.toLowerCase() || '';
    if (r.includes('secret') || r.includes('alt art')) return 'bg-gradient-to-r from-purple-500 to-pink-500';
    if (r.includes('super rare') || r === 'sr') return 'bg-yellow-500';
    if (r.includes('rare') || r === 'r') return 'bg-blue-500';
    if (r.includes('uncommon') || r === 'uc') return 'bg-green-500';
    if (r.includes('leader') || r === 'l') return 'bg-red-500';
    return 'bg-gray-500';
}

export const OnePieceCardItem = React.memo(function OnePieceCardItem({ card }: OnePieceCardItemProps) {
    const { formatPrice } = useCurrency();
    const router = useRouter();

    const handleCardClick = () => {
        router.push(`/products/${card.product_id}`);
    };

    const handleViewClick = () => {
        if (card.tcgplayer_url) {
            window.open(card.tcgplayer_url, '_blank');
        }
    };


    return (
        <Card
            onClick={handleCardClick}
            className="overflow-hidden flex flex-col bg-card/80 hover:bg-card transition-all duration-300 group rounded-2xl sm:rounded-3xl border shadow-lg hover:shadow-xl border-red-500/20 hover:border-red-500/40 cursor-pointer">
            {/* Image section */}
            <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800">
                {card.image_url ? (
                    <Image
                        src={card.image_url}
                        alt={card.name}
                        fill
                        className="object-contain transition-transform duration-500 group-hover:scale-105 p-2"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <StrawHatIcon className="w-16 h-16 text-red-500/30" />
                    </div>
                )}

                {/* Rarity badge - top left */}
                {card.rarity && (
                    <Badge
                        className={`absolute top-2 sm:top-3 left-2 sm:left-3 ${getRarityColor(card.rarity)} text-white text-[9px] sm:text-[10px] font-bold backdrop-blur-md border border-white/20 shadow-lg px-2 py-0.5 tracking-wider hover:scale-105 transition-transform duration-300`}
                    >
                        {card.rarity}
                    </Badge>
                )}

                {/* Card number - top right */}
                {card.number && (
                    <Badge
                        variant="secondary"
                        className="absolute top-2 sm:top-3 right-2 sm:right-3 bg-black/60 text-white text-[9px] sm:text-[10px] font-bold backdrop-blur-md border border-white/10 shadow-lg px-2 py-0.5 tracking-wider font-mono hover:bg-black/70 transition-colors"
                    >
                        #{card.number}
                    </Badge>
                )}
            </div>

            {/* Content section */}
            <div className="p-3 sm:p-4 md:p-5 flex flex-col flex-grow" style={{ fontFamily: "'Quantico', sans-serif" }}>
                {/* Title */}
                <h3 className="font-bold text-sm sm:text-base md:text-lg line-clamp-2 mb-1">
                    {card.name}
                </h3>

                {/* Set name */}
                {card.set_name && (
                    <p className="text-xs sm:text-sm text-red-400/80 mb-3 sm:mb-4 line-clamp-1 font-medium">
                        {card.set_name}
                    </p>
                )}


                {/* Price grid - Switched to flexible layout for long prices */}
                <div className="flex flex-col gap-2 text-xs mb-3 sm:mb-4">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Market</span>
                        <span className="font-bold text-sm sm:text-base text-red-500">
                            {card.market_price ? formatPrice(card.market_price) : '-'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Low</span>
                        <span className="font-medium text-sm sm:text-base text-green-400">
                            {card.low_price ? formatPrice(card.low_price) : '-'}
                        </span>
                    </div>
                </div>


            </div>
        </Card>
    );
});
