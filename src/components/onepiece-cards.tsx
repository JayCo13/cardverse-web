"use client";

import React, { useEffect, useState, useRef } from "react";
import { OnePieceCardItem, type OnePieceCard } from "./onepiece-card-item";
import { getSupabaseClient } from "@/lib/supabase/client";
import { SpinnerGap, ArrowsClockwise } from "@phosphor-icons/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useLocalization } from "@/context/localization-context";
import { StrawHatIcon, JollyRogerIcon } from "@/components/icons/onepiece-icons";

export function OnePieceCards() {
    const [cards, setCards] = useState<OnePieceCard[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasFetched = useRef(false);
    const { t } = useLocalization();

    const fetchCards = async () => {
        if (hasFetched.current) return;
        hasFetched.current = true;
        setLoading(true);
        setError(null);

        try {
            const supabase = getSupabaseClient();
            // Query the materialized view for instant results
            const { data, error: fetchError } = await supabase
                .from('featured_onepiece_cards')
                .select('*');

            if (fetchError) throw fetchError;
            setCards(data || []);
        } catch (err) {
            console.error('One Piece fetch error:', err);
            setError('Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Stagger load - wait 600ms before fetching (after Soccer)
        const timer = setTimeout(fetchCards, 600);
        return () => {
            clearTimeout(timer);
            hasFetched.current = false; // Reset on cleanup so data reloads on navigation
        };
    }, []);

    if (loading) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-center py-20">
                        <SpinnerGap className="w-8 h-8 animate-spin text-red-500" weight="bold" />
                        <span className="ml-3 text-white/60">Loading One Piece cards...</span>
                    </div>
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="py-12 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-red-400 mb-4">{error}</p>
                        <Button onClick={fetchCards} variant="outline" className="gap-2">
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
                            <div className="absolute -inset-1 bg-gradient-to-r from-red-500 to-orange-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                            <div className="relative p-4 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl shadow-2xl transition-all duration-300 group-hover:scale-105 group-hover:bg-black/50 overflow-hidden ring-1 ring-white/10">
                                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                <div className="relative w-16 h-16 md:w-20 md:h-20">
                                    <Image
                                        src="/assets/one-logo.png"
                                        alt="One Piece Logo"
                                        fill
                                        className="object-contain drop-shadow-xl"
                                        priority
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <h2 className="text-2xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-orange-500 to-red-600 font-headline tracking-wider mb-2 drop-shadow-md break-words">
                                    {t("one_piece_tcg_title")}
                                </h2>
                            </div>
                            <p className="text-sm sm:text-base text-red-100/70 font-body tracking-wide break-words">
                                {t("one_piece_tcg_desc")}
                            </p>
                        </div>
                    </div>

                    <div className="flex justify-end md:justify-start">
                        <Button
                            onClick={fetchCards}
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 font-body tracking-wide"
                        >
                            <ArrowsClockwise className="w-4 h-4 mr-2" />
                            {t("refresh")}
                        </Button>
                    </div>
                </div>

                {/* Cards Grid */}
                {cards.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                        {cards.map((card) => (
                            <OnePieceCardItem key={card.product_id} card={card} />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="relative w-16 h-16 mb-4 opacity-30">
                            <Image
                                src="/assets/one-logo.png"
                                alt="One Piece Logo"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <p className="text-white/50">No One Piece cards found</p>
                        <p className="text-sm text-white/30 mt-1">Run the crawler to populate cards</p>
                    </div>
                )}

                {/* View All Link */}
                {cards.length > 0 && (
                    <div className="flex justify-center mt-8">
                        <Button
                            variant="outline"
                            className="rounded-full px-8 border-red-500/50 text-red-400 hover:bg-red-500/10 font-body"
                        >
                            {t("view_all_one_piece")}
                        </Button>
                    </div>
                )}
            </div>
        </section>
    );
}

export default OnePieceCards;
