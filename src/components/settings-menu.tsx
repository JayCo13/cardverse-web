"use client";

import React from 'react';
import { Globe, DollarSign } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useCurrency, CURRENCY_OPTIONS, LANGUAGE_OPTIONS, AppCurrency, AppLanguage } from '@/contexts/currency-context';

export function SettingsMenu() {
    const { currency, language, setCurrency, setLanguage } = useCurrency();

    const currentCurrency = CURRENCY_OPTIONS.find(c => c.value === currency);
    const currentLanguage = LANGUAGE_OPTIONS.find(l => l.value === language);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                    <span className="text-lg">{currentLanguage?.flag}</span>
                    <span className="font-medium">{currentCurrency?.symbol}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {/* Currency Section */}
                <DropdownMenuLabel className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Currency
                </DropdownMenuLabel>
                {CURRENCY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => setCurrency(option.value as AppCurrency)}
                        className={currency === option.value ? 'bg-accent' : ''}
                    >
                        <span className="mr-2">{option.symbol}</span>
                        {option.label}
                        {currency === option.value && <span className="ml-auto">✓</span>}
                    </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />

                {/* Language Section */}
                <DropdownMenuLabel className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Language
                </DropdownMenuLabel>
                {LANGUAGE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => setLanguage(option.value as AppLanguage)}
                        className={language === option.value ? 'bg-accent' : ''}
                    >
                        <span className="mr-2">{option.flag}</span>
                        {option.label}
                        {language === option.value && <span className="ml-auto">✓</span>}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
