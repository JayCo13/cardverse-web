"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trophy, Star } from "lucide-react";
import { useCurrency } from "@/contexts/currency-context";

export interface SoccerCard {
    id: string;
    name: string;
    image_url: string | null;
    price: number; // Now stored as USD cents
    category: string;
    year: string | null;
    grader: string | null;
    grade: string | null;
    set_name: string | null;
    player_name: string | null;
    ebay_id: string;
}

interface SoccerCardItemProps {
    card: SoccerCard;
}

export const SoccerCardItem = React.memo(function SoccerCardItem({ card }: SoccerCardItemProps) {
    const router = useRouter();
    const { formatPrice, currency } = useCurrency();

    // Price is stored as raw USD dollars
    // For VND, apply 50% discount (divide by 2)
    const priceInUSD = currency === 'VND' ? card.price / 2 : card.price;

    const handleViewClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Open eBay listing
        // Clean ID: "v1|317765753645|0" -> "317765753645"
        let cleanId = card.ebay_id;
        if (cleanId.includes('|')) {
            cleanId = cleanId.split('|')[1];
        }
        window.open(`https://www.ebay.com/itm/${cleanId}`, '_blank');
    };

    const handleCardClick = () => {
        // Store card data in session for quick load
        sessionStorage.setItem('viewingSoccerCard', JSON.stringify(card));
        router.push(`/soccer/${card.id}`);
    };

    // Get grader color
    const getGraderColor = (grader: string | null) => {
        switch (grader?.toUpperCase()) {
            case 'PSA': return 'bg-red-500/80';
            case 'BGS': return 'bg-blue-500/80';
            case 'SGC': return 'bg-green-500/80';
            case 'CGC': return 'bg-purple-500/80';
            default: return 'bg-gray-500/80';
        }
    };


    return (
        <Card
            onClick={handleCardClick}
            className="overflow-hidden flex flex-col bg-card/80 hover:bg-card transition-all duration-300 group rounded-2xl sm:rounded-3xl border shadow-lg hover:shadow-xl border-green-500/20 hover:border-green-500/40 cursor-pointer"
        >
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
                        <Trophy className="w-16 h-16 text-green-500/30" />
                    </div>
                )}

                {/* Year badge - top left */}
                {card.year && (
                    <Badge
                        variant="secondary"
                        className="absolute top-2 sm:top-3 left-2 sm:left-3 bg-black/60 text-white text-[9px] sm:text-[10px] font-bold backdrop-blur-md border border-white/10 shadow-lg px-2 py-0.5 tracking-wider hover:bg-black/70 transition-colors"
                    >
                        {card.year}
                    </Badge>
                )}

                {/* Graded badge - top right */}
                {card.grader && card.grade && (
                    <Badge
                        className={`absolute top-2 sm:top-3 right-2 sm:right-3 ${getGraderColor(card.grader)} text-white text-[9px] sm:text-[10px] font-bold backdrop-blur-md border border-white/20 shadow-lg px-2 py-0.5 tracking-wider gap-1 hover:scale-105 transition-transform`}
                    >
                        <span className="opacity-75">{card.grader}</span>
                        <span>{card.grade}</span>
                    </Badge>
                )}

                {/* Player name - bottom overlay */}
                {card.player_name && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 sm:p-4">
                        <div className="flex items-center gap-1.5 transform translate-y-1 group-hover:translate-y-0 transition-transform duration-300">
                            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                            <span className="text-white font-bold text-sm tracking-wide" style={{ fontFamily: "'Quantico', sans-serif" }}>
                                {card.player_name.toUpperCase()}
                            </span>
                        </div>
                    </div>
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
                    <p className="text-xs sm:text-sm text-green-400/80 mb-3 sm:mb-4 line-clamp-1 font-medium">
                        {card.set_name}
                    </p>
                )}

                {/* Footer with price and button */}
                <div className="flex flex-col items-center mt-auto pt-3 sm:pt-4 border-t border-green-500/20 gap-3">
                    {/* Price */}
                    <span className="font-bold text-lg sm:text-xl md:text-2xl text-green-400">
                        {formatPrice(priceInUSD)}
                    </span>
                </div>
            </div>
        </Card>
    );
});
