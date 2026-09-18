/** Comparison only: keep the original name for display and storage. */
export function normalizeVietnameseName(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Unlike accented vowels, Đ does not decompose under Unicode NFD.
    .replace(/Đ/g, 'D')
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Banks, document fields and MRZ can order name parts differently.
 * Compare a multiset: ignore order but require every word and its count.
 * This checks name compatibility, not unique identity or account control.
 */
export function namesMatch(a: string, b: string): boolean {
  const tokens = (value: string) => {
    const words = normalizeVietnameseName(value).split(' ').filter(Boolean);
    return words.length ? words.sort().join(' ') : '';
  };
  const left = tokens(a);
  return !!left && left === tokens(b);
}
