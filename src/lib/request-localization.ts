import { translations, type TranslationKey } from '@/lib/i18n';

export type SupportedLocale = keyof typeof translations;

const SUPPORTED_LOCALES = new Set<SupportedLocale>(['en-US', 'vi-VN', 'ja-JP']);

export function getRequestLocale(request: Request): SupportedLocale {
  const requestedLocale = request.headers.get('x-cardverse-locale') as SupportedLocale | null;
  if (requestedLocale && SUPPORTED_LOCALES.has(requestedLocale)) {
    return requestedLocale;
  }

  const acceptedLanguage = request.headers.get('accept-language')?.toLowerCase() || '';
  if (acceptedLanguage.startsWith('vi')) return 'vi-VN';
  if (acceptedLanguage.startsWith('ja')) return 'ja-JP';
  return 'en-US';
}

export function translateRequest(
  request: Request,
  key: TranslationKey,
  variables?: Record<string, string>,
): string {
  const locale = getRequestLocale(request);
  let result = translations[locale][key] || translations['en-US'][key] || key;

  Object.entries(variables || {}).forEach(([variable, value]) => {
    result = result.replace(new RegExp(`{${variable}}`, 'g'), value);
  });

  return result;
}
