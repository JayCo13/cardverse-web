// Client-side HEIC/HEIF → JPEG conversion for KYC uploads.
//
// iPhones produce HEIC files that browsers cannot render and many pipelines
// choke on. We convert at selection time (one file at a time, as the user picks
// it) so the rest of the flow only ever deals with JPEG. heic2any is loaded
// dynamically because it is browser-only and must not run during SSR.

export function isHeicFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
        file.type === 'image/heic' ||
        file.type === 'image/heif' ||
        name.endsWith('.heic') ||
        name.endsWith('.heif')
    );
}

export async function convertHeicToJpeg(file: File, quality = 0.9): Promise<File> {
    const heic2any = (await import('heic2any')).default as (
        opts: { blob: Blob; toType?: string; quality?: number }
    ) => Promise<Blob | Blob[]>;

    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality });
    const blob = Array.isArray(result) ? result[0] : result;
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([blob], newName, { type: 'image/jpeg' });
}
