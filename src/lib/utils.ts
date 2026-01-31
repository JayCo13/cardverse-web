import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getHighResImageUrl(url: string | null | undefined): string {
  if (!url) return '';

  // TCGPlayer specific optimization - upgrade to 400w for better quality
  if (url.includes('tcgplayer')) {
    // Replace _200w with _400w for higher resolution (base URL without suffix returns 403)
    return url.replace(/_200w\.jpg$/, '_400w.jpg');
  }

  return url;
}
