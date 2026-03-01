"use client";

import React, { createContext, useContext, ReactNode } from 'react';
import { translations, TranslationKey } from '@/lib/i18n';
import { useCurrency, AppLanguage } from '@/contexts/currency-context';

// Map language codes to i18n locale keys
const LOCALE_MAP: Record<AppLanguage, 'en-US' | 'vi-VN' | 'ja-JP'> = {
  'en-US': 'en-US',
  'vi-VN': 'vi-VN',
  'ja-JP': 'ja-JP',
};

interface LocalizationContextType {
  locale: string;
  currency: string;
  t: (key: TranslationKey, variables?: Record<string, string>) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

export const LocalizationProvider = ({ children }: { children: ReactNode }) => {
  // Get language from currency context
  const { language, currency } = useCurrency();

  // Map to i18n locale
  const i18nLocale = LOCALE_MAP[language] || 'en-US';

  const t = (key: TranslationKey, variables?: Record<string, string>): string => {
    const localeKey = i18nLocale as keyof typeof translations;
    const translationSet = translations[localeKey] as Record<string, string>;
    let result = key as string;

    if (translationSet && key in translationSet) {
      result = translationSet[key];
    } else if ((translations['en-US'] as Record<string, string>)[key]) {
      // Fallback to English
      result = (translations['en-US'] as Record<string, string>)[key];
    }

    // Replace variables if provided
    if (variables && result) {
      Object.entries(variables).forEach(([varKey, value]) => {
        result = result.replace(new RegExp(`{${varKey}}`, 'g'), value);
      });
    }

    return result;
  };

  return (
    <LocalizationContext.Provider value={{ locale: language, currency, t }}>
      {children}
    </LocalizationContext.Provider>
  );
};

export const useLocalization = () => {
  const context = useContext(LocalizationContext);
  if (context === undefined) {
    throw new Error('useLocalization must be used within a LocalizationProvider');
  }
  return context;
};
