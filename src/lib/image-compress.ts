// Client-side image downscale + re-encode before upload.
//
// iPhone / DSLR photos are often 3-8 MB at huge resolutions. Uploading them
// raw is slow and frequently times out. We shrink to a sane max dimension and
// re-encode as JPEG in the browser so only a few hundred KB ever leave the
// device. Browser-only (uses canvas) — never call during SSR.

interface CompressOptions {
    /** Longest edge in pixels; image is scaled down to fit. */
    maxDimension?: number;
    /** JPEG quality 0-1. */
    quality?: number;
    /** Skip compression for files already under this size (bytes). */
    skipUnderBytes?: number;
}

export async function compressImage(
    file: File,
    { maxDimension = 1600, quality = 0.85, skipUnderBytes = 400 * 1024 }: CompressOptions = {}
): Promise<File> {
    // Tiny files: not worth the work.
    if (file.size <= skipUnderBytes) return file;

    // Only handle raster images we can draw.
    if (!file.type.startsWith('image/')) return file;

    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        // Unsupported by createImageBitmap (e.g. some HEIC) — leave as-is.
        return file;
    }

    const { width, height } = bitmap;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        bitmap.close?.();
        return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob) return file;

    // If somehow larger than the original, keep the original.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
}
