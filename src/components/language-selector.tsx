"use client";

import React from 'react';
import { Globe } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useCurrency, LANGUAGE_OPTIONS, AppLanguage } from '@/contexts/currency-context';

export function LanguageSelector() {
    const { language, setLanguage } = useCurrency();
    const currentLanguage = LANGUAGE_OPTIONS.find(l => l.value === language);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="relative group gap-2 px-3 hover:bg-white/5 border border-white/20 hover:border-white/40 rounded-full transition-all duration-300"
                >
                    <div className="absolute inset-0 bg-blue-500/10 rounded-full opacity-0 group-hover:opacity-100 blur transition-opacity duration-500" />
                    <span className="text-xl relative z-10 filter drop-shadow-md group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all">
                        {currentLanguage?.flag}
                    </span>
                    <span className="font-display font-medium text-muted-foreground group-hover:text-blue-200 transition-colors uppercase tracking-wider text-xs relative z-10">
                        {currentLanguage?.value.split('-')[0].toUpperCase()}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-xl border-white/10">
                {LANGUAGE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => setLanguage(option.value as AppLanguage)}
                        className={`
                            group flex items-center gap-3 py-3 px-4 focus:bg-blue-500/20 focus:text-blue-200 cursor-pointer transition-colors
                            ${language === option.value ? 'bg-blue-500/10 text-blue-200' : 'text-muted-foreground'}
                        `}
                    >
                        <span className="text-xl filter drop-shadow-md group-hover:scale-110 transition-transform">
                            {option.flag}
                        </span>
                        <div className="flex flex-col">
                            <span className="font-display font-medium text-sm tracking-wide">
                                {option.label}
                            </span>
                            {language === option.value && (
                                <span className="text-[10px] text-blue-400 uppercase tracking-widest">
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
