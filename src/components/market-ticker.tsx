"use client";

import { TrendDown, TrendUp } from "@phosphor-icons/react";

const MARKET_DATA = [
    { text: "Charizard Base Set PSA 10 valued at $350,000", change: "up" },
    { text: "Messi Rookie Auto valued at $12,500", change: "down" },
    { text: "New Valuation Request: One Piece Luffy Gear 5", change: "neutral" },
    { text: "Black Lotus Alpha PSA 9 valued at $85,000", change: "up" },
    { text: "Jordan Fleer Rookie PSA 8 valued at $7,200", change: "down" },
    { text: "Recent Sale: Pikachu Illustrator PSA 7 - $480,000", change: "up" },
];

export function MarketTicker() {
    return (
        <div className="w-full bg-black/60 border-y border-white/5 backdrop-blur-sm h-10 flex items-center overflow-hidden relative z-30">
            <div className="flex animate-marquee whitespace-nowrap">
                {[...MARKET_DATA, ...MARKET_DATA, ...MARKET_DATA].map((item, index) => (
                    <div key={index} className="flex items-center mx-8 text-xs md:text-sm font-medium text-gray-300">
                        <span className="mr-2">{item.text}</span>
                        {item.change === "up" && <TrendUp className="w-3 h-3 text-green-500" weight="bold" />}
                        {item.change === "down" && <TrendDown className="w-3 h-3 text-red-500" weight="bold" />}
                        {item.change === "neutral" && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </div>
                ))}
            </div>

            {/* CSS for marquee animation if not in global css */}
            <style jsx>{`
        .animate-marquee {
          animation: marquee 40s linear infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
        </div>
    );
}
