"use client";

import React, { useEffect } from "react";
import { PokemonCardItem } from "./pokemon-card-item";
import { SpinnerGap, ArrowsClockwise } from "@phosphor-icons/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useLocalization } from "@/context/localization-context";
import { useCardCache } from "@/contexts/card-cache-context";
import type { PokemonCard } from "@/lib/types";

export function PokemonCards() {
    const { t } = useLocalization();
    const { pokemon, pokemonLoading, pokemonError, fetchPokemon } = useCardCache();

    useEffect(() => {
        // Stagger load - wait 200ms before fetching
        const timer = setTimeout(() => fetchPokemon(), 200);
        return () => clearTimeout(timer);
    }, [fetchPokemon]);

    // Transform cached data to component format
    const cards: PokemonCard[] = pokemon.map(item => ({
        id: item.product_id,
        productId: item.product_id,
        name: item.name,
        imageUrl: item.image_url || '',
        setName: item.set_name || '',
        number: '',
        rarity: '',
        marketPrice: item.market_price,
        lowPrice: item.low_price,
        midPrice: null,
        highPrice: null,
        tcgplayerUrl: null,
        categoryId: 3,
        groupId: 0,
    }));

    if (pokemonLoading && cards.length === 0) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-center py-20">
                        <SpinnerGap className="w-8 h-8 animate-spin text-yellow-500" weight="bold" />
                        <span className="ml-3 text-white/60">Loading Pokemon cards...</span>
                    </div>
                </div>
            </section>
        );
    }

    if (pokemonError && cards.length === 0) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-red-400 mb-4">{pokemonError}</p>
                        <Button onClick={() => fetchPokemon(true)} variant="outline" className="gap-2">
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
                            <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                            <div className="relative p-3 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl shadow-2xl transition-all duration-300 group-hover:scale-105 group-hover:bg-black/50 overflow-hidden ring-1 ring-white/10">
                                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                <div className="relative w-16 h-16 md:w-20 md:h-20">
                                    <Image
                                        src="/assets/pok-logo.png"
                                        alt="Pokemon Logo"
                                        fill
                                        className="object-contain drop-shadow-xl"
                                        priority
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <h2 className="text-2xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-400 to-yellow-500 font-headline tracking-wider mb-2 drop-shadow-md break-words">
                                    {t("pokemon_tcg_title")}
                                </h2>
                            </div>
                            <p className="text-sm sm:text-base text-yellow-100/70 font-body tracking-wide break-words">
                                {t("pokemon_tcg_desc")}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Cards Grid */}
                {cards.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                        {cards.map((card) => (
                            <PokemonCardItem key={card.id} card={card} />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="relative w-16 h-16 mb-4 opacity-30">
                            <Image
                                src="/assets/pok-logo.png"
                                alt="Pokemon Logo"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <p className="text-white/50">No Pokemon cards found</p>
                        <p className="text-sm text-white/30 mt-1">Sync TCGCSV data to populate cards</p>
                    </div>
                )}

                {/* View All Link */}
                {cards.length > 0 && (
                    <div className="flex justify-center mt-8">
                        <Button
                            variant="outline"
                            className="rounded-full px-8 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                        >
                            View All Pokemon Cards
                        </Button>
                    </div>
                )}
            </div>
        </section>
    );
}

export default PokemonCards;
