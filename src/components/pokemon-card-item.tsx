"use client";

import React from "react";
import type { PokemonCard } from "@/lib/types";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/contexts/currency-context";
import { TrendUp, TrendDown } from "@phosphor-icons/react";

interface PokemonCardItemProps {
    card: PokemonCard;
}

export const PokemonCardItem = React.memo(function PokemonCardItem({ card }: PokemonCardItemProps) {
    const { formatPrice } = useCurrency();
    const router = useRouter();

    const handleCardClick = () => {
        if (card.productId) {
            router.push(`/products/${card.productId}`);
        }
    };

    // Calculate price difference for trend indicator
    const priceDiff = card.marketPrice && card.lowPrice
        ? ((card.marketPrice - card.lowPrice) / card.lowPrice * 100).toFixed(0)
        : null;
    const isPositive = priceDiff && parseFloat(priceDiff) > 0;

    return (
        <div
            onClick={handleCardClick}
            className="group relative cursor-pointer"
        >
            {/* Glow effect on hover */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-500/0 to-orange-500/0 group-hover:from-yellow-500/20 group-hover:to-orange-500/20 rounded-2xl blur-xl transition-all duration-500 opacity-0 group-hover:opacity-100" />

            {/* Main card */}
            <div className="relative bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 backdrop-blur-xl rounded-2xl overflow-hidden border border-white/5 group-hover:border-yellow-500/30 transition-all duration-300 shadow-xl">

                {/* Image container with gradient overlay */}
                <div className="relative aspect-[3/4] overflow-hidden">
                    {/* Background gradient */}
                    <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 via-transparent to-orange-500/10" />

                    {card.imageUrl ? (
                        <Image
                            src={card.imageUrl}
                            alt={card.name}
                            fill
                            className="object-contain p-3 transition-transform duration-500 group-hover:scale-110"
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <span className="text-4xl">⚡</span>
                        </div>
                    )}

                    {/* Set name badge - floating glass style */}
                    {card.setName && (
                        <div className="absolute top-2 left-2 right-2">
                            <span className="inline-block px-2 py-1 text-[10px] sm:text-xs font-medium bg-black/40 backdrop-blur-md rounded-lg text-white/80 border border-white/10 truncate max-w-full">
                                {card.setName.length > 25 ? card.setName.slice(0, 25) + '...' : card.setName}
                            </span>
                        </div>
                    )}

                    {/* Card number badge - below set name */}
                    {card.number && (
                        <div className="absolute top-10 left-2">
                            <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-white/90 backdrop-blur-md rounded text-black border border-white/20">
                                #{card.number}
                            </span>
                        </div>
                    )}


                </div>

                {/* Content section - minimal and clean */}
                <div className="p-3 sm:p-4">
                    {/* Title - fixed height for consistency */}
                    <h3 className="font-semibold text-sm sm:text-base text-white line-clamp-2 h-10 sm:h-12 mb-2 group-hover:text-yellow-400 transition-colors">
                        {card.name}
                    </h3>

                    {/* Price grid - Similar to One Piece layout */}
                    <div className="flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between">
                            <span className="text-white/40 text-[10px] uppercase tracking-wider">Market</span>
                            <span className="font-bold text-sm sm:text-base text-yellow-500">
                                {card.marketPrice ? formatPrice(card.marketPrice) : '-'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 pt-2">
                            <span className="text-white/40 text-[10px] uppercase tracking-wider">Low</span>
                            <span className="font-medium text-sm sm:text-base text-green-400">
                                {card.lowPrice ? formatPrice(card.lowPrice) : '-'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
