import type { TranslationKey } from '@/lib/i18n';
import type { AppLanguage } from '@/contexts/currency-context';

export type HomeAnnouncement = {
  id: string;
  enabled: boolean;
  order: number;
  title: TranslationKey | 'CardVerseHub';
  description: TranslationKey[];
  short?: TranslationKey;
  /** ISO calendar date (YYYY-MM-DD); rendered per locale via formatAnnouncementDate. */
  date?: string;
  banner?: boolean;
  images: string[];
  /** One artwork, or one per language when copy is drawn into the image. */
  illustration?: string | Record<AppLanguage, string>;
  /** Decorative glass badges floated around the illustration. */
  badges?: { label: TranslationKey; icon: 'storefront' | 'shield' | 'truck' | 'handshake'; position: 'tl' | 'tr' | 'bl' | 'br' }[];
  actions: { href: string; label: TranslationKey; seller?: boolean }[];
};

// Change the ID for a new announcement to reset its per-session banner state.
// Copy lives in i18n/{vi,en,ja}.ts. Changes to this configuration require deployment.
export const homeAnnouncements: HomeAnnouncement[] = [
  {
    id: 'marketplace-launch-20260918', enabled: true, order: 0, banner: true,
    // The three feature badges are drawn into the artwork, one file per language, so they stay pinned
    // to the laptop at every width; set `badges` again only if a text-free mockup comes back.
    illustration: {
      'vi-VN': '/assets/marketplace-launch-hero-vi.png',
      'en-US': '/assets/marketplace-launch-hero-en.png',
      'ja-JP': '/assets/marketplace-launch-hero-ja.png',
    },
    date: '2026-09-18', title: 'launch_title', short: 'launch_short',
    description: ['launch_description'],
    images: ['/assets/imgmain.webp', '/assets/imgmain3.jpg', '/assets/imgmain2.webp'],
    actions: [{ href: '/buy', label: 'launch_buy' }, { href: '/sell', label: 'launch_register', seller: true }],
  },
  {
    id: 'cardverse-introduction', enabled: true, order: 1,
    title: 'CardVerseHub',
    description: ['hero_subtitle_1', 'hero_subtitle_2', 'hero_subtitle_3', 'hero_subtitle_4', 'hero_subtitle_5'],
    images: ['/assets/imgmain3.jpg', '/assets/imgmain2.webp', '/assets/imgmain.webp'],
    actions: [{ href: '/buy', label: 'explore_community' }, { href: '/collection', label: 'hero_secondary_cta' }],
  },
];

/** Localises an ISO date without a timezone shift (midnight UTC would roll back a day west of Greenwich). */
export function formatAnnouncementDate(date: string, locale: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(year, month - 1, day));
}

/** The artwork for the visitor's language; a single-file illustration is used as is. */
export function announcementIllustration(announcement: HomeAnnouncement, locale: string) {
  const { illustration } = announcement;
  if (!illustration || typeof illustration === 'string') return illustration;
  return illustration[locale as AppLanguage] ?? illustration['en-US'];
}

/** Banner label: the short copy when present, otherwise the full title. */
export function announcementLabel(announcement: HomeAnnouncement, t: (key: TranslationKey) => string) {
  if (announcement.short) return t(announcement.short);
  return announcement.title === 'CardVerseHub' ? announcement.title : t(announcement.title);
}

export function announcementVisibleOnPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.some(part => ['create', 'edit', 'checkout', 'verify', 'verification', 'kyc'].includes(part))) return false;
  return path === '/' || ['buy', 'sell', 'pokemon', 'onepiece', 'soccer', 'collection', 'cards', 'products'].includes(parts[0]);
}
