import { en } from './i18n/en';
import { vi } from './i18n/vi';
import { ja } from './i18n/ja';

export const translations = {
  'en-US': en,
  'vi-VN': vi,
  'ja-JP': ja,
};

export type TranslationKey = keyof typeof en;
