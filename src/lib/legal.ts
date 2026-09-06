import type { TranslationKey } from '@/lib/i18n';

/**
 * The date the three legal documents were last revised.
 *
 * It is a constant, not `new Date()`. The terms and privacy pages used to print
 * `new Date().toLocaleDateString()`, so "last updated" moved to today on every
 * page load — a document that claims to have changed every day tells the reader
 * nothing, and for a consumer-facing policy it is the one date that has to be
 * true. Bump this whenever the copy in `src/lib/i18n/*.ts` actually changes.
 */
export const LEGAL_LAST_UPDATED = '2026-09-06';

export type LegalSection = { title: TranslationKey; desc: TranslationKey };

/**
 * Section keys follow `<prefix>_section_<n>_{title,desc}` in every dictionary,
 * so the pages iterate a count instead of listing 40 keys by hand. Keep these
 * counts in step with `en.ts`; a key that is missing everywhere renders as its
 * own name, which is loud enough to catch in review.
 */
const sections = (prefix: string, count: number): LegalSection[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `${prefix}_section_${i + 1}_title` as TranslationKey,
    desc: `${prefix}_section_${i + 1}_desc` as TranslationKey,
  }));

export const TERMS_SECTIONS = sections('terms', 15);
export const PRIVACY_SECTIONS = sections('privacy', 13);
export const COMPLAINTS_SECTIONS = sections('complaints', 12);

/** The three documents cross-link to each other from every one of them. */
export const LEGAL_PAGES: { href: string; label: TranslationKey }[] = [
  { href: '/terms', label: 'page_terms_title' },
  { href: '/privacy', label: 'page_privacy_title' },
  { href: '/complaints', label: 'page_complaints_title' },
];
