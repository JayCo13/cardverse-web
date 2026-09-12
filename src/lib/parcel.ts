/**
 * What goes in the box, as far as a carrier is concerned.
 *
 * Carriers bill by weight and volume, so every quote — the buyer's at checkout
 * and the seller's at booking — needs grams and centimetres. Nobody weighs a
 * card, so the defaults below stand in, one per kind of thing the shop sells
 * (the same six kinds the listing form offers). They were taken from
 * published product sheets and shipping forums on 2026-09-12 and padded for a
 * mailer or a carton:
 *
 *   card      a raw card in a toploader, or a PSA slab (~85g), in a bubble mailer
 *   pack      one booster pack (22–23g) in a mailer
 *   deck      a theme / battle deck (190–210g) in its box
 *   accessory sleeves, a deck box, a small binder
 *   box       a 36-pack booster box (~800g, 13×12×8cm) or an ETB (~300g,
 *             19×17×9cm) in a carton
 *   other     anything else, mid-sized
 *
 * A seller who packs differently edits the numbers when booking and may save
 * them as their own default for that kind (profiles.parcel_overrides); checkout
 * then quotes buyers with the seller's numbers too, so the price the buyer
 * pays and the parcel the seller books stay the same parcel.
 */

import { PRODUCT_KINDS, type ProductKind } from '@/lib/product-listing';

export type Parcel = { weight: number; width: number; height: number; length: number };

export const PARCEL_PRESETS: Readonly<Record<ProductKind, Parcel>> = {
  card: { weight: 150, width: 12, height: 2, length: 20 },
  pack: { weight: 100, width: 12, height: 2, length: 18 },
  deck: { weight: 300, width: 15, height: 6, length: 22 },
  accessory: { weight: 300, width: 20, height: 5, length: 25 },
  box: { weight: 1000, width: 16, height: 12, length: 20 },
  other: { weight: 500, width: 20, height: 10, length: 25 },
};

/** Kept for callers that still say "preset": a preset is a product kind. */
export type ParcelPreset = ProductKind;
export const PARCEL_PRESET_CODES: readonly ParcelPreset[] = PRODUCT_KINDS;
export const DEFAULT_PARCEL_PRESET: ParcelPreset = 'card';

export const isParcelPreset = (value: unknown): value is ParcelPreset =>
  typeof value === 'string' && Object.hasOwn(PARCEL_PRESETS, value);

/** A stored kind, or the default when the value is missing or unknown (old rows say 'raw'). */
export const parcelPresetOr = (value: unknown, fallback: ParcelPreset = DEFAULT_PARCEL_PRESET): ParcelPreset =>
  isParcelPreset(value) ? value : fallback;

/** The seller's own numbers per kind, where they saved any. */
export type ParcelOverrides = Partial<Record<ParcelPreset, Parcel>>;

const WEIGHT_MAX = 30_000;
const SIDE_MAX = 200;

export const isParcel = (value: unknown): value is Parcel => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (['weight', 'width', 'height', 'length'] as const).every((key) => {
    const n = p[key];
    return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= (key === 'weight' ? WEIGHT_MAX : SIDE_MAX);
  });
};

/** Only known kinds with valid parcels survive; anything else is dropped, not refused. */
export const parseParcelOverrides = (value: unknown): ParcelOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ParcelOverrides = {};
  for (const [kind, parcel] of Object.entries(value as Record<string, unknown>)) {
    if (isParcelPreset(kind) && isParcel(parcel)) out[kind] = { ...parcel };
  }
  return out;
};

/**
 * The parcel for a kind, sized for the number of listings going in it.
 *
 * The seller's saved numbers win over the default. Only `card` grows with the
 * count — 50g per card after the first — since several cards from one shop
 * still go in one mailer; a second box is a second parcel and is not modelled.
 */
export const parcelFor = (kind: ParcelPreset, cardCount = 1, overrides?: ParcelOverrides | null): Parcel => {
  const base = overrides?.[kind] ?? PARCEL_PRESETS[kind];
  if (kind !== 'card') return { ...base };
  const extra = Math.max(0, Math.round(cardCount) - 1) * 50;
  return { ...base, weight: base.weight + extra };
};

/** The heaviest kind among several listings — the carton the rest fit in. */
export const heaviestPreset = (kinds: ParcelPreset[], overrides?: ParcelOverrides | null): ParcelPreset =>
  kinds.reduce((heaviest, kind) => (
    parcelFor(kind, 1, overrides).weight > parcelFor(heaviest, 1, overrides).weight ? kind : heaviest
  ), kinds[0] ?? DEFAULT_PARCEL_PRESET);

export const DEFAULT_PARCEL: Parcel = { ...PARCEL_PRESETS.card };

export function parseParcel(body: Record<string, unknown> | null, required = false): Parcel | null {
  const parcel = { ...DEFAULT_PARCEL };
  for (const key of ['weight', 'width', 'height', 'length'] as const) {
    const value = body?.[key];
    if (value === undefined && !required) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > (key === 'weight' ? WEIGHT_MAX : SIDE_MAX)) return null;
    parcel[key] = Math.ceil(n);
  }
  return parcel;
}

export function parcelCopy(locale: string) {
  return locale === 'vi-VN' ? { width: 'Rộng (cm)', height: 'Cao (cm)', length: 'Dài (cm)', invalid: 'Nhập cân nặng (1–30.000g) và kích thước kiện đã đóng gói (1–200cm).', hint: 'Thông số của toàn bộ kiện đã đóng gói, gồm hộp và lớp chống sốc.' }
    : locale === 'ja-JP' ? { width: '幅（cm）', height: '高さ（cm）', length: '長さ（cm）', invalid: '梱包後の重量（1–30,000g）と寸法（1–200cm）を入力してください。', hint: '箱と緩衝材を含めた梱包後の寸法です。' }
    : { width: 'Width (cm)', height: 'Height (cm)', length: 'Length (cm)', invalid: 'Enter packed weight (1–30,000g) and dimensions (1–200cm).', hint: 'Measure the complete parcel, including its box and padding.' };
}

/** Labels for the kind dropdown — the listing form's words, so they match. */
export function parcelPresetLabels(locale: string): Record<ParcelPreset, string> {
  return locale === 'vi-VN'
    ? { card: 'Thẻ bài', box: 'Box / Hộp', pack: 'Pack / Gói thẻ', deck: 'Deck / Bộ sản phẩm', accessory: 'Phụ kiện', other: 'Khác' }
    : locale === 'ja-JP'
      ? { card: 'カード', box: 'ボックス', pack: 'パック', deck: 'デッキ', accessory: 'アクセサリー', other: 'その他' }
      : { card: 'Card', box: 'Box', pack: 'Pack', deck: 'Deck', accessory: 'Accessory', other: 'Other' };
}
