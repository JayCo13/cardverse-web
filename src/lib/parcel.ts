export const DEFAULT_PARCEL = { weight: 200, width: 15, height: 3, length: 20 };
export function parseParcel(body: Record<string, unknown> | null, required = false) {
  const parcel = { ...DEFAULT_PARCEL };
  for (const key of ['weight', 'width', 'height', 'length'] as const) {
    const value = body?.[key];
    if (value === undefined && !required) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > (key === 'weight' ? 30000 : 200)) return null;
    parcel[key] = Math.ceil(n);
  }
  return parcel;
}
export function parcelCopy(locale: string) {
  return locale === 'vi-VN' ? { width: 'Rộng (cm)', height: 'Cao (cm)', length: 'Dài (cm)', invalid: 'Nhập cân nặng (1–30.000g) và kích thước kiện đã đóng gói (1–200cm).', hint: 'Thông số của toàn bộ kiện đã đóng gói, gồm hộp và lớp chống sốc.' }
    : locale === 'ja-JP' ? { width: '幅（cm）', height: '高さ（cm）', length: '長さ（cm）', invalid: '梱包後の重量（1–30,000g）と寸法（1–200cm）を入力してください。', hint: '箱と緩衝材を含めた梱包後の寸法です。' }
    : { width: 'Width (cm)', height: 'Height (cm)', length: 'Length (cm)', invalid: 'Enter packed weight (1–30,000g) and dimensions (1–200cm).', hint: 'Measure the complete parcel, including its box and padding.' };
}
