"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

// Supported Currencies
export type AppCurrency = 'USD' | 'JPY' | 'VND';

// Supported Languages
export type AppLanguage = 'en-US' | 'vi-VN' | 'ja-JP';

// How many VND in 1 USD. Single source of truth for any USD→VND conversion
// (e.g. the sell form lets a seller price in USD and stores VND).
export const USD_TO_VND_RATE = 25450;

// Exchange rates (base: USD)
const EXCHANGE_RATES: Record<AppCurrency, number> = {
    USD: 1,
    JPY: 155,
    VND: USD_TO_VND_RATE,
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
// The server-issued stamp for the choice this browser is holding, so a device
// sitting on a stale preference cannot overwrite a newer choice made elsewhere.
// Absent for anyone who picked a language before this was introduced.
const LANGUAGE_CHOSEN_AT_KEY = 'cardverse_language_at';
// Which account the two keys above belong to. Without it, a shared browser
// carries one person's language across sign-out and pushes it into the next
// person's account.
const LANGUAGE_OWNER_KEY = 'cardverse_language_user';

const DEFAULT_LANGUAGE: AppLanguage = 'en-US';

const isAppLanguage = (value: unknown): value is AppLanguage =>
    value === 'en-US' || value === 'vi-VN' || value === 'ja-JP';

/**
 * Mirror the language choice onto the account so the server can reach it.
 *
 * The UI reads the preference from localStorage, which transactional email can
 * never see: an offer notification is composed on the server for the *other*
 * party, in a request that has none of that party's browser state. Without this
 * copy, `getOfferEmailRecipient` finds no locale and every offer email falls
 * back to English regardless of the language the recipient browses in.
 *
 * Goes through `/api/user/locale` rather than `auth.updateUser` so the ordering
 * stamp comes from the server's clock. Devices disagree, and a machine running
 * fast would otherwise write a future timestamp and win every comparison
 * forever. Returns the stamp the server assigned, or null if nothing was saved.
 *
 * Never throws — a failed write must not block a language switch.
 */
type PersistedLocale = { stamp: string; userId: string };

async function persistLanguageToAccount(language: AppLanguage): Promise<PersistedLocale | null> {
    try {
        const response = await fetch('/api/user/locale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale: language }),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        if (typeof payload?.localeUpdatedAt !== 'string' || typeof payload?.userId !== 'string') {
            return null;
        }
        return { stamp: payload.localeUpdatedAt, userId: payload.userId };
    } catch {
        // Signed out, offline, or rejected — the local preference stands.
        return null;
    }
}

/** Milliseconds since the epoch, or null for a missing/unparseable stamp. */
function parseStamp(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
    const [currency, setCurrencyState] = useState<AppCurrency>('USD');
    const [language, setLanguageState] = useState<AppLanguage>('en-US');
    const [isHydrated, setIsHydrated] = useState(false);
    // Whether the browser had an explicit choice saved before this session.
    const hasLocalLanguage = useRef(false);
    // When that choice was made, if this browser recorded it.
    const localChosenAt = useRef<number | null>(null);
    // The account the stored choice belongs to. `null` means it was made while
    // signed out, and so belongs to whoever signs in next.
    const localOwner = useRef<string | null>(null);
    // Latest choice, readable from the long-lived auth listener without
    // re-subscribing it on every switch.
    const languageRef = useRef<AppLanguage>('en-US');
    useEffect(() => {
        languageRef.current = language;
    }, [language]);

    // Load saved preferences on mount
    useEffect(() => {
        const savedCurrency = localStorage.getItem(CURRENCY_STORAGE_KEY) as AppCurrency;
        const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) as AppLanguage;

        if (savedCurrency && ['USD', 'JPY', 'VND'].includes(savedCurrency)) {
            setCurrencyState(savedCurrency);
        }
        if (isAppLanguage(savedLanguage)) {
            hasLocalLanguage.current = true;
            localChosenAt.current = parseStamp(localStorage.getItem(LANGUAGE_CHOSEN_AT_KEY));
            localOwner.current = localStorage.getItem(LANGUAGE_OWNER_KEY);
            setLanguageState(savedLanguage);
        }
        setIsHydrated(true);
    }, []);

    // Reconcile the browser preference with the signed-in account.
    //
    // The two can legitimately disagree — someone switches to Japanese on their
    // phone, then opens the laptop that still remembers English — so the more
    // recent choice wins rather than whichever device happens to load. Without
    // that, the laptop would quietly push its stale English back onto the account
    // and the next email would arrive in the wrong language: exactly the bug this
    // whole mechanism exists to fix.
    useEffect(() => {
        if (!isHydrated) return;
        const supabase = getSupabaseClient();

        const adoptAccountLocale = (userId: string, accountLocale: AppLanguage, stamp: number | null) => {
            setLanguageState(accountLocale);
            localStorage.setItem(LANGUAGE_STORAGE_KEY, accountLocale);
            localStorage.setItem(LANGUAGE_CHOSEN_AT_KEY, new Date(stamp ?? Date.now()).toISOString());
            localStorage.setItem(LANGUAGE_OWNER_KEY, userId);
            hasLocalLanguage.current = true;
            localChosenAt.current = stamp ?? Date.now();
            localOwner.current = userId;
        };

        const clearStoredLanguage = () => {
            localStorage.removeItem(LANGUAGE_STORAGE_KEY);
            localStorage.removeItem(LANGUAGE_CHOSEN_AT_KEY);
            localStorage.removeItem(LANGUAGE_OWNER_KEY);
            hasLocalLanguage.current = false;
            localChosenAt.current = null;
            localOwner.current = null;
            setLanguageState(DEFAULT_LANGUAGE);
        };

        const pushLocalToAccount = async () => {
            const saved = await persistLanguageToAccount(languageRef.current);
            if (!saved) return;
            // Re-stamp locally with what the server actually recorded, so the next
            // comparison comes from the one clock everyone shares.
            localStorage.setItem(LANGUAGE_CHOSEN_AT_KEY, saved.stamp);
            localStorage.setItem(LANGUAGE_OWNER_KEY, saved.userId);
            localChosenAt.current = Date.parse(saved.stamp);
            localOwner.current = saved.userId;
        };

        const reconcile = (userId: string, metadata: Record<string, unknown> | undefined) => {
            const accountLocale = isAppLanguage(metadata?.locale) ? metadata.locale : null;
            const accountStamp = parseStamp(metadata?.locale_updated_at);

            // A stored choice belongs to whoever made it. On a shared browser the
            // previous person's language must not follow the next one into their
            // account — unless it was made signed out, in which case it is a
            // genuine unclaimed preference from this session.
            const localIsForThisUser = hasLocalLanguage.current
                && (localOwner.current === null || localOwner.current === userId);

            if (!localIsForThisUser) {
                if (accountLocale) {
                    adoptAccountLocale(userId, accountLocale, accountStamp);
                } else {
                    // A shared computer, and this account has never chosen. The
                    // owner marker already stops the previous person's language
                    // being written to this account, but leaving it on screen is
                    // its own leak — the new person is simply shown someone
                    // else's preference. Drop it and fall back to the default.
                    clearStoredLanguage();
                }
                return;
            }

            // A stamped account choice is a real decision made somewhere. An
            // unstamped one is only the locale captured at sign-up, which is a
            // guess and must never override a language the person actually picked.
            if (accountLocale && accountStamp !== null) {
                if (localChosenAt.current === null || accountStamp > localChosenAt.current) {
                    adoptAccountLocale(userId, accountLocale, accountStamp);
                    return;
                }
                // Same language, but the account's stamp is older than this
                // device's. Re-push so the account carries the newer stamp;
                // leaving it stale lets a third device with an in-between stamp
                // later overwrite a more recent deliberate choice.
                if (accountLocale === languageRef.current && accountStamp === localChosenAt.current) return;
            }

            void pushLocalToAccount();
        };

        // `getUser()` rather than `getSession()`: the session's `user_metadata`
        // comes out of the stored JWT and stays as it was when that token was
        // minted, so a language changed on another device is invisible here for
        // up to an hour. This asks the server, which is the whole point of
        // keeping a stamped copy on the account.
        void supabase.auth.getUser().then(({ data }) => {
            if (data.user) reconcile(data.user.id, data.user.user_metadata);
        });

        const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
            // USER_UPDATED and TOKEN_REFRESHED are the events that carry fresh
            // metadata mid-session; listening only for SIGNED_IN meant a
            // cross-device change waited for the next sign-in.
            const carriesFreshMetadata = event === 'SIGNED_IN'
                || event === 'USER_UPDATED'
                || event === 'TOKEN_REFRESHED';
            if (carriesFreshMetadata && session?.user) {
                reconcile(session.user.id, session.user.user_metadata);
            }
        });

        return () => subscription.subscription.unsubscribe();
    }, [isHydrated]);

    const setCurrency = useCallback((newCurrency: AppCurrency) => {
        setCurrencyState(newCurrency);
        localStorage.setItem(CURRENCY_STORAGE_KEY, newCurrency);
    }, []);

    const setLanguage = useCallback((newLanguage: AppLanguage) => {
        setLanguageState(newLanguage);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, newLanguage);
        hasLocalLanguage.current = true;
        // Provisional local stamp so an offline switch still beats an older
        // account value; replaced below by the server's, which is authoritative.
        const provisional = new Date().toISOString();
        localStorage.setItem(LANGUAGE_CHOSEN_AT_KEY, provisional);
        localChosenAt.current = Date.parse(provisional);

        void persistLanguageToAccount(newLanguage).then(saved => {
            if (!saved) return;
            localStorage.setItem(LANGUAGE_CHOSEN_AT_KEY, saved.stamp);
            localStorage.setItem(LANGUAGE_OWNER_KEY, saved.userId);
            localChosenAt.current = Date.parse(saved.stamp);
            localOwner.current = saved.userId;
        });
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
