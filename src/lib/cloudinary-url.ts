/**
 * Optimize Cloudinary image URLs by adding transformation parameters.
 * This dramatically reduces image size (60-80%) while maintaining visual quality.
 * 
 * @example
 * optimizeCloudinaryUrl('https://res.cloudinary.com/.../image/upload/v123/cards/xyz.jpg', 400)
 * // => 'https://res.cloudinary.com/.../image/upload/f_auto,q_auto,w_400/v123/cards/xyz.jpg'
 */
export function optimizeCloudinaryUrl(url: string, width = 400): string {
    if (!url) return url;

    // Only transform Cloudinary URLs
    if (!url.includes('res.cloudinary.com')) return url;

    // Check if transforms already applied
    if (url.includes('f_auto') || url.includes('q_auto')) return url;

    // Insert transforms after /upload/
    return url.replace(
        '/upload/',
        `/upload/f_auto,q_auto,w_${width}/`
    );
}

/**
 * Generate a tiny Cloudinary blur placeholder URL (10px wide, very low quality)
 */
export function getCloudinaryBlurUrl(url: string): string {
    if (!url || !url.includes('res.cloudinary.com')) return '';

    return url.replace(
        '/upload/',
        '/upload/f_auto,q_10,w_10,e_blur:1000/'
    );
}

export function getCloudinaryJpgUrl(url: string): string {
    if (!url || !url.includes('res.cloudinary.com')) return url;

    let transformed = url.includes('/upload/f_jpg,q_auto/')
        ? url
        : url.replace('/upload/', '/upload/f_jpg,q_auto/');

    transformed = transformed.replace(/\.(heic|heif)(\?.*)?$/i, '.jpg$2');
    return transformed;
}

// File extensions browsers render natively. Anything outside this set (notably
// HEIC/HEIF from iPhones) must be converted to JPEG for display.
const FAMILIAR_IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

export function isFamiliarImageFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return FAMILIAR_IMG_EXT.includes(ext);
}

/**
 * Return a display-safe URL: unfamiliar extensions (HEIC...) are forced to JPEG
 * via Cloudinary so browsers can render them; familiar formats are kept as-is.
 */
export function toDisplaySafeUrl(fileName: string, secureUrl: string): string {
    return isFamiliarImageFile(fileName) ? secureUrl : getCloudinaryJpgUrl(secureUrl);
}

export function getCloudinaryKycScanUrl(url: string): string {
    if (!url || !url.includes('res.cloudinary.com')) return url;

    let transformed = url.includes('/upload/f_jpg,q_100/')
        ? url
        : url.replace('/upload/', '/upload/f_jpg,q_100/');

    transformed = transformed.replace(/\.(heic|heif)(\?.*)?$/i, '.jpg$2');
    return transformed;
}

export function getCloudinaryKycBackScanUrl(url: string): string {
    if (!url || !url.includes('res.cloudinary.com')) return url;

    let transformed = url.includes('/upload/f_jpg,q_100/')
        ? url
        : url.replace('/upload/', '/upload/f_jpg,q_100/');

    transformed = transformed.replace(/\.(heic|heif)(\?.*)?$/i, '.jpg$2');
    return transformed;
}
