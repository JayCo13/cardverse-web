"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// Supported Currencies
export type AppCurrency = 'USD' | 'JPY' | 'VND';

// Supported Languages
export type AppLanguage = 'en-US' | 'vi-VN' | 'ja-JP';

// Exchange rates (base: USD)
const EXCHANGE_RATES: Record<AppCurrency, number> = {
    USD: 1,
    JPY: 155,
    VND: 25450,
};

// Currency symbols and formatting
const CURRENCY_CONFIG: Record<AppCurrency, { symbol: string; decimals: number; locale: string }> = {
    USD: { symbol: '$', decimals: 2, locale: 'en-US' },
    JPY: { symbol: '¥', decimals: 0, locale: 'ja-JP' },
    VND: { symbol: '₫', decimals: 0, locale: 'vi-VN' },
};

interface CurrencyContextType {
    currency: AppCurrency;
    language: AppLanguage;
    setCurrency: (currency: AppCurrency) => void;
    setLanguage: (language: AppLanguage) => void;
    formatPrice: (usdPrice: number | null, category?: string) => string;
    convertPrice: (usdPrice: number, category?: string) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const CURRENCY_STORAGE_KEY = 'cardverse_currency';
const LANGUAGE_STORAGE_KEY = 'cardverse_language';

export function CurrencyProvider({ children }: { children: ReactNode }) {
    const [currency, setCurrencyState] = useState<AppCurrency>('USD');
    const [language, setLanguageState] = useState<AppLanguage>('en-US');
    const [isHydrated, setIsHydrated] = useState(false);

    // Load saved preferences on mount
    useEffect(() => {
        const savedCurrency = localStorage.getItem(CURRENCY_STORAGE_KEY) as AppCurrency;
        const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) as AppLanguage;

        if (savedCurrency && ['USD', 'JPY', 'VND'].includes(savedCurrency)) {
            setCurrencyState(savedCurrency);
        }
        if (savedLanguage && ['en-US', 'vi-VN', 'ja-JP'].includes(savedLanguage)) {
            setLanguageState(savedLanguage);
        }
        setIsHydrated(true);
    }, []);

    const setCurrency = useCallback((newCurrency: AppCurrency) => {
        setCurrencyState(newCurrency);
        localStorage.setItem(CURRENCY_STORAGE_KEY, newCurrency);
    }, []);

    const setLanguage = useCallback((newLanguage: AppLanguage) => {
        setLanguageState(newLanguage);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, newLanguage);
    }, []);

    /**
     * Convert USD price to selected currency
     * Special: Soccer cards get 50% discount in VND (Vietnam market adjustment)
     */
    const convertPrice = useCallback((usdPrice: number, category?: string): number => {
        const rate = EXCHANGE_RATES[currency];
        let price = usdPrice * rate;

        // Apply 50% discount for soccer cards in VND
        if (currency === 'VND' && category?.toLowerCase() === 'soccer') {
            price = price / 2;
        }

        return price;
    }, [currency]);

    /**
     * Format price with currency symbol and proper formatting
     */
    const formatPrice = useCallback((usdPrice: number | null, category?: string): string => {
        if (usdPrice === null || usdPrice === undefined) {
            return '-';
        }

        const config = CURRENCY_CONFIG[currency];
        const convertedPrice = convertPrice(usdPrice, category);

        try {
            const formatter = new Intl.NumberFormat(config.locale, {
                style: 'currency',
                currency: currency,
                minimumFractionDigits: config.decimals,
                maximumFractionDigits: config.decimals,
            });
            return formatter.format(convertedPrice);
        } catch {
            // Fallback formatting
            const rounded = config.decimals === 0 ? Math.round(convertedPrice) : convertedPrice.toFixed(config.decimals);
            return `${config.symbol}${rounded.toLocaleString()}`;
        }
    }, [currency, convertPrice]);

    return (
        <CurrencyContext.Provider value={{
            currency,
            language,
            setCurrency,
            setLanguage,
            formatPrice,
            convertPrice,
        }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency() {
    const context = useContext(CurrencyContext);
    if (context === undefined) {
        throw new Error('useCurrency must be used within a CurrencyProvider');
    }
    return context;
}

// Export currency options for UI selectors
export const CURRENCY_OPTIONS: { value: AppCurrency; label: string; symbol: string }[] = [
    { value: 'USD', label: 'US Dollar', symbol: '$' },
    { value: 'JPY', label: 'Japanese Yen', symbol: '¥' },
    { value: 'VND', label: 'Vietnamese Dong', symbol: '₫' },
];

export const LANGUAGE_OPTIONS: { value: AppLanguage; label: string; flag: string }[] = [
    { value: 'en-US', label: 'English', flag: '🇺🇸' },
    { value: 'vi-VN', label: 'Tiếng Việt', flag: '🇻🇳' },
    { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
];
