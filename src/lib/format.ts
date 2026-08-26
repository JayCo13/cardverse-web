/**
 * Shortens large counts so compact UI rows remain a single line.
 *
 * Vietnamese compact notation uses locale-specific suffixes ("N", "Tr") that
 * are less familiar in marketplace UI, so use the conventional K/M fallback.
 */
export function formatCompactCount(n: number, locale = "vi-VN") {
  const compactLocale = locale === "vi-VN" ? "en-US" : locale;

  return new Intl.NumberFormat(compactLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
