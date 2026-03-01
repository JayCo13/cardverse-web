"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrendDown, TrendUp } from "@phosphor-icons/react";
import { useCardCache } from "@/contexts/card-cache-context";
import { useCurrency } from "@/contexts/currency-context";

// Hardcoded fallback data shown while real data loads
const FALLBACK_DATA = [
    { text: "Loading market data...", change: "neutral" as const },
    { text: "Loading market data...", change: "neutral" as const },
    { text: "Loading market data...", change: "neutral" as const },
];

interface TickerItem {
    text: string;
    change: "up" | "down" | "neutral";
}

/**
 * Deterministic shuffle using a simple seed so the order stays consistent
 * across re-renders but varies per session via Date-based seed.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
    const shuffled = [...arr];
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function MarketTicker() {
    const { pokemon, soccer, onepiece, fetchPokemon, fetchSoccer, fetchOnepiece } = useCardCache();
    const { formatPrice } = useCurrency();
    const hasFetched = useRef(false);
    const [sessionSeed] = useState(() => Math.floor(Date.now() / 60000)); // stable per minute

    // Trigger data fetches on mount (idempotent — cache prevents redundant calls)
    useEffect(() => {
        if (!hasFetched.current) {
            hasFetched.current = true;
            fetchPokemon();
            fetchSoccer();
            fetchOnepiece();
        }
    }, [fetchPokemon, fetchSoccer, fetchOnepiece]);

    // Build ticker items from real card data
    const tickerItems: TickerItem[] = useMemo(() => {
        const items: TickerItem[] = [];

        // Pokemon cards
        pokemon.forEach((card) => {
            if (card.market_price && card.market_price > 0) {
                const change: "up" | "down" | "neutral" =
                    card.low_price && card.market_price > card.low_price
                        ? "up"
                        : card.low_price && card.market_price < card.low_price
                            ? "down"
                            : "neutral";
                items.push({
                    text: `${card.name} — ${formatPrice(card.market_price)}`,
                    change,
                });
            }
        });

        // Soccer cards
        soccer.forEach((card) => {
            if (card.price && card.price > 0) {
                const grade = card.grade ? ` ${card.grader || ''} ${card.grade}`.trim() : '';
                items.push({
                    text: `${card.name}${grade} — ${formatPrice(card.price, 'soccer')}`,
                    change: "neutral",
                });
            }
        });

        // One Piece cards
        onepiece.forEach((card) => {
            if (card.market_price && card.market_price > 0) {
                const change: "up" | "down" | "neutral" =
                    card.low_price && card.market_price > card.low_price
                        ? "up"
                        : card.low_price && card.market_price < card.low_price
                            ? "down"
                            : "neutral";
                items.push({
                    text: `${card.name} — ${formatPrice(card.market_price)}`,
                    change,
                });
            }
        });

        if (items.length === 0) return FALLBACK_DATA;

        // Deterministic shuffle + pick up to 12 items for variety
        const shuffled = seededShuffle(items, sessionSeed);
        return shuffled.slice(0, 12);
    }, [pokemon, soccer, onepiece, formatPrice, sessionSeed]);

    // Triple the items for seamless looping animation
    const displayItems = useMemo(
        () => [...tickerItems, ...tickerItems, ...tickerItems],
        [tickerItems]
    );

    return (
        <div className="w-full bg-black/60 border-y border-white/5 backdrop-blur-sm h-10 flex items-center overflow-hidden relative z-30">
            <div className="flex animate-marquee whitespace-nowrap">
                {displayItems.map((item, index) => (
                    <div key={index} className="flex items-center mx-8 text-xs md:text-sm font-medium text-gray-300">
                        <span className="mr-2">{item.text}</span>
                        {item.change === "up" && <TrendUp className="w-3 h-3 text-green-500" weight="bold" />}
                        {item.change === "down" && <TrendDown className="w-3 h-3 text-red-500" weight="bold" />}
                        {item.change === "neutral" && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </div>
                ))}
            </div>

            {/* CSS for marquee animation */}
            <style jsx>{`
        .animate-marquee {
          animation: marquee 40s linear infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.33%); }
        }
      `}</style>
        </div>
    );
}
