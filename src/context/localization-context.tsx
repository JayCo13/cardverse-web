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
  t: (key: TranslationKey) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

export const LocalizationProvider = ({ children }: { children: ReactNode }) => {
  // Get language from currency context
  const { language, currency } = useCurrency();

  // Map to i18n locale
  const i18nLocale = LOCALE_MAP[language] || 'en-US';

  const t = (key: TranslationKey): string => {
    const translationSet = translations[i18nLocale];
    if (translationSet && key in translationSet) {
      return translationSet[key];
    }
    // Fallback to English
    return translations['en-US'][key] || key;
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
