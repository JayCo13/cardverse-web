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
