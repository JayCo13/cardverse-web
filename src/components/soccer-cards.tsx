"use client";

import React, { useEffect } from "react";
import { SoccerCardItem, type SoccerCard } from "./soccer-card-item";
import { SpinnerGap, ArrowsClockwise } from "@phosphor-icons/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useLocalization } from "@/context/localization-context";
import { useCardCache } from "@/contexts/card-cache-context";

export function SoccerCards() {
    const { t } = useLocalization();
    const { soccer, soccerLoading, soccerError, fetchSoccer } = useCardCache();

    useEffect(() => {
        // Stagger load - wait 400ms before fetching (after Pokemon)
        const timer = setTimeout(() => fetchSoccer(), 400);
        return () => clearTimeout(timer);
    }, [fetchSoccer]);

    // Transform cached data to component format
    const cards: SoccerCard[] = soccer.map(item => ({
        id: item.id,
        name: item.name,
        image_url: item.image_url,
        price: item.price ?? 0,
        category: item.category ?? '',
        year: item.year,
        grader: item.grader,
        grade: item.grade,
        set_name: null,
        player_name: null,
        ebay_id: item.ebay_id ?? '',
    }));

    if (soccerLoading && cards.length === 0) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-center py-20">
                        <SpinnerGap className="w-8 h-8 animate-spin text-green-500" weight="bold" />
                        <span className="ml-3 text-white/60">Loading soccer cards...</span>
                    </div>
                </div>
            </section>
        );
    }

    if (soccerError && cards.length === 0) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-red-400 mb-4">{soccerError}</p>
                        <Button onClick={() => fetchSoccer(true)} variant="outline" className="gap-2">
                            <ArrowsClockwise className="w-4 h-4" />
                            Retry
                        </Button>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="py-12 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div className="flex items-start md:items-center gap-4 max-w-full">
                        <div className="relative group shrink-0">
                            <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                            <div className="relative p-3 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl shadow-2xl transition-all duration-300 group-hover:scale-105 group-hover:bg-black/50 overflow-hidden ring-1 ring-white/10">
                                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                <div className="relative w-16 h-16 md:w-20 md:h-20">
                                    <Image
                                        src="/assets/soc-logo.png"
                                        alt="Soccer Logo"
                                        fill
                                        className="object-contain drop-shadow-xl"
                                        priority
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <h2 className="text-2xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-emerald-400 to-green-500 font-headline tracking-wider mb-2 drop-shadow-md break-words">
                                    {t("soccer_cards_title")}
                                </h2>
                            </div>
                            <p className="text-sm sm:text-base text-green-100/70 font-body tracking-wide break-words">
                                {t("soccer_cards_desc")}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Cards Grid */}
                {cards.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                        {cards.map((card) => (
                            <SoccerCardItem key={card.id} card={card} />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="relative w-16 h-16 mb-4 opacity-30">
                            <Image
                                src="/assets/soc-logo.png"
                                alt="Soccer Logo"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <p className="text-white/50">No soccer cards found</p>
                        <p className="text-sm text-white/30 mt-1">Run the crawler to populate cards</p>
                    </div>
                )}

                {/* View All Link */}
                {cards.length > 0 && (
                    <div className="flex justify-center mt-8">
                        <Button
                            variant="outline"
                            className="rounded-full px-8 border-green-500/50 text-green-400 hover:bg-green-500/10 font-body"
                        >
                            {t("view_all_soccer")}
                        </Button>
                    </div>
                )}
            </div>
        </section>
    );
}

export default SoccerCards;
