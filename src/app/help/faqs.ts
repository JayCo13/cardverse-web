import type { TranslationKey } from '@/lib/i18n';
import type { FaqItem } from '@/lib/seo/jsonld';

export const HELP_FAQ_COUNT = 15;

export function helpFaqs(t: (key: TranslationKey) => string): FaqItem[] {
  const items: FaqItem[] = [];
  for (let index = 1; index <= HELP_FAQ_COUNT; index += 1) {
    const question = t(`help_faq_${index}_q` as TranslationKey);
    const answer = t(`help_faq_${index}_a` as TranslationKey);
    if (question && answer) items.push({ question, answer });
  }
  return items;
}
