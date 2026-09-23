/**
 * The one description of CardVerseHub that every machine-readable surface
 * reads: page metadata, the Organization / WebSite JSON-LD, `llms.txt`, the
 * about page. Search engines and answer engines cross-check the name,
 * description and contact details they find here against Facebook, Zalo and
 * whatever else mentions the site — a mismatch costs trust, so nothing else in
 * the codebase restates these values.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cardversehub.com';
export const SITE_NAME = 'CardVerseHub';

/** Every share sheet (Messenger, Zalo, Facebook) shows this square logo. */
export const OG_IMAGE = '/assets/og-logo.jpg';
export const LOGO_PATH = '/assets/brow-logo.png';

export const SITE_TITLE = 'CardVerseHub – Sàn giao dịch thẻ bài Pokémon, One Piece, bóng đá';

/**
 * Vietnamese first: the audience searches in Vietnamese and Google's AI
 * Overview was translating the English text on its own. The English copy stays
 * for the `en` alternates and for readers who switch language.
 */
export const SITE_DESCRIPTION_VI =
  'CardVerseHub là sàn giao dịch thẻ bài sưu tầm tại Việt Nam: mua, bán, trả giá thẻ Pokémon, One Piece và thẻ cầu thủ bóng đá. Thanh toán ký quỹ, phí vận chuyển được báo trước khi thanh toán.';
export const SITE_DESCRIPTION_EN =
  "Vietnam's marketplace for Pokémon, One Piece and Soccer trading cards. Buy, sell and make offers with escrow payments and shipping fees shown before checkout.";

export const SITE_KEYWORDS = [
  'thẻ bài pokemon', 'mua thẻ pokemon', 'bán thẻ pokemon', 'thẻ one piece', 'thẻ bóng đá',
  'sàn giao dịch thẻ bài', 'trading cards Vietnam', 'Pokemon cards', 'One Piece cards', 'Soccer cards',
];

/** Legal contact, identical to the Terms and Privacy pages. */
export const ORGANIZATION = {
  legalName: 'CardVerseHub',
  email: 'cardversehub.vn@gmail.com',
  phone: '+84 812 334 511',
  address: {
    streetAddress: '48A Thị Mười, Tân Chánh Hiệp',
    addressLocality: 'Quận 12',
    addressRegion: 'Thành phố Hồ Chí Minh',
    addressCountry: 'VN',
  },
} as const;

/**
 * Official profiles, from configuration: the footer renders an icon only for a
 * destination that is set, and the Organization schema lists the same ones as
 * `sameAs`. Add a key here and in `.env` to link a new profile everywhere.
 */
export function socialProfiles(): string[] {
  return [
    process.env.NEXT_PUBLIC_FACEBOOK_URL,
    process.env.NEXT_PUBLIC_ZALO_URL,
    process.env.NEXT_PUBLIC_TIKTOK_URL,
    process.env.NEXT_PUBLIC_YOUTUBE_URL,
    process.env.NEXT_PUBLIC_INSTAGRAM_URL,
  ].filter((url): url is string => Boolean(url));
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, SITE_URL).toString();
}
