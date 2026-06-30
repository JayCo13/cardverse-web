/**
 * Canonical short codes for card categories, used on compact UI surfaces
 * (badges, chips, related-card thumbnails). This is the SINGLE SOURCE OF TRUTH —
 * any place that shows a category badge in code form must use this so codes stay
 * consistent (e.g. "Bóng đá"/"Soccer"/"Football" → "SOC").
 */
export const getCategoryCode = (category: string | null | undefined): string => {
  const normalized = (category || '').toLowerCase();
  if (normalized.includes('pokemon') || normalized.includes('pokémon')) return 'POK';
  if (normalized.includes('one piece')) return 'OP';
  if (normalized.includes('soccer') || normalized.includes('football') || normalized.includes('bóng đá')) return 'SOC';
  if (normalized.includes('basketball') || normalized.includes('nba') || normalized.includes('bóng rổ')) return 'NBA';
  if (normalized.includes('yugioh') || normalized.includes('yu-gi-oh')) return 'YGO';
  if (normalized.includes('f1') || normalized.includes('formula')) return 'F1';
  if (normalized.includes('khác') || normalized.includes('other')) return 'OTH';
  return (category || '').slice(0, 3).toUpperCase();
};
