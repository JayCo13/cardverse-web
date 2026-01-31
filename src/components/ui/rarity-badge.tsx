import React from 'react';
import { cn } from '@/lib/utils';
import { Crown, Gem, Sparkles, Star, Hexagon } from 'lucide-react';

interface RarityBadgeProps {
    rarity: string;
    className?: string;
    side?: 'left' | 'right';
}

export const RarityBadge = ({ rarity, className, side = 'left' }: RarityBadgeProps) => {
    const lowerRarity = (rarity || '').toLowerCase();

    // Tier logic
    let tier = 'common';
    if (lowerRarity.includes('secret') || lowerRarity.includes('hyper') || lowerRarity.includes('special')) {
        tier = 'diamond';
    } else if (lowerRarity.includes('ultra') || lowerRarity.includes('rainbow') || lowerRarity.includes('ex') || lowerRarity.includes('vmax') || lowerRarity.includes('gold')) {
        tier = 'platinum';
    } else if (lowerRarity.includes('full art') || lowerRarity.includes('illustration') || lowerRarity.includes('rare')) {
        tier = 'gold';
    } else if (lowerRarity.includes('holo') || lowerRarity.includes('uncommon')) {
        tier = 'silver';
    }

    // Unified Orange Theme for all tiers as requested
    // Unified Metallic Shiny Orange Theme
    const orangeTheme = {
        iconBg: 'bg-gradient-to-br from-amber-200 via-orange-500 to-red-700',
        pillBg: 'bg-gradient-to-r from-orange-400 via-orange-600 to-red-600',
        border: 'border-zinc-900/80 ring-1 ring-zinc-700/50',
        textColor: 'text-black',
        shadow: 'shadow-orange-500/50',
    };

    // Tier styles maps only the Icon now, colors are unified
    const styles = {
        diamond: { ...orangeTheme, icon: Crown },
        platinum: { ...orangeTheme, icon: Gem },
        gold: { ...orangeTheme, icon: Star },
        silver: { ...orangeTheme, icon: Sparkles },
        common: { ...orangeTheme, icon: Hexagon }
    };

    const currentStyle = styles[tier as keyof typeof styles];
    const Icon = currentStyle.icon;

    const isRight = side === 'right';

    return (
        <div className={cn(
            "relative flex items-center group/badge transform scale-110 sm:scale-125",
            isRight ? "flex-row-reverse origin-top-right" : "flex-row origin-top-left",
            className
        )}>
            {/* Icon Container */}
            <div className={cn(
                "relative z-10 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-sm rotate-45 shadow-lg transition-transform group-hover/badge:scale-110 duration-300 border-2 border-zinc-800",
                currentStyle.iconBg,
                currentStyle.shadow
            )}>
                <div className="absolute inset-[3px] border border-white/40 rounded-sm" />
                <Icon className={cn("-rotate-45 w-3.5 h-3.5 sm:w-4 sm:h-4 text-white drop-shadow-md")} strokeWidth={2.5} />
            </div>

            {/* Text Pill */}
            <div className={cn(
                "relative py-1.5 flex items-center h-6 sm:h-7 shadow-md border-t border-b transition-all duration-300",
                isRight
                    ? "-mr-3.5 pr-5 pl-4 rounded-l-xl border-l group-hover/badge:pl-5"
                    : "-ml-3.5 pl-5 pr-4 rounded-r-xl border-r group-hover/badge:pr-5",
                currentStyle.pillBg,
                currentStyle.border
            )}>
                {/* Shine effect */}
                <div className={cn(
                    "absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none",
                    isRight ? "rounded-l-xl" : "rounded-r-xl"
                )} />

                <span className={cn(
                    "text-[10px] sm:text-xs font-bold uppercase tracking-wider relative z-10 truncate max-w-[120px] sm:max-w-[150px]",
                    currentStyle.textColor
                )} style={{ fontFamily: "'Quantico', sans-serif" }}>
                    {rarity || 'Common'}
                </span>
            </div>
        </div>
    );
};
