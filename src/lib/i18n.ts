import { en } from './i18n/en';
import { vi } from './i18n/vi';
import { ja } from './i18n/ja';

export type TranslationKey = keyof typeof en;
type TranslationDictionary = Record<TranslationKey, string>;

export const translations = {
  'en-US': en,
  'vi-VN': vi satisfies TranslationDictionary,
  'ja-JP': ja satisfies TranslationDictionary,
};
