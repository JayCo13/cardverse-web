"use client";

import React from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useCurrency, CURRENCY_OPTIONS, AppCurrency } from '@/contexts/currency-context';

export function CurrencySelector() {
    const { currency, setCurrency } = useCurrency();
    const currentCurrency = CURRENCY_OPTIONS.find(c => c.value === currency);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="relative group gap-2 px-3 hover:bg-white/5 border border-white/20 hover:border-white/40 rounded-full transition-all duration-300"
                >
                    <div className="absolute inset-0 bg-white/5 rounded-full opacity-0 group-hover:opacity-100 blur transition-opacity duration-500" />
                    <span className="font-display font-bold text-lg text-white/90 group-hover:text-white relative z-10 transition-colors drop-shadow-sm group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">
                        {currentCurrency?.symbol}
                    </span>
                    <span className="font-display font-medium text-muted-foreground group-hover:text-white/80 transition-colors uppercase tracking-wider text-xs relative z-10">
                        {currentCurrency?.value}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-xl border-white/10">
                {CURRENCY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => setCurrency(option.value as AppCurrency)}
                        className={`
                            group flex items-center gap-3 py-3 px-4 focus:bg-white/10 focus:text-white cursor-pointer transition-colors
                            ${currency === option.value ? 'bg-white/5 text-white' : 'text-muted-foreground'}
                        `}
                    >
                        <span className="font-display font-bold text-lg w-6 text-center group-hover:scale-110 transition-transform text-white/90">
                            {option.symbol}
                        </span>
                        <div className="flex flex-col">
                            <span className="font-display font-medium text-sm tracking-wide">
                                {option.label}
                            </span>
                            {currency === option.value && (
                                <span className="text-[10px] text-white/60 uppercase tracking-widest">
                                    Active
                                </span>
                            )}
                        </div>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
