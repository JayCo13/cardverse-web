export interface DirectCloudinaryUploadResult {
    secureUrl: string;
}

export type CloudinarySignaturePayload = {
    cloudName: string;
    apiKey: string;
    folder: string;
    timestamp: number;
    signature: string;
};

export async function getCloudinarySignature(): Promise<CloudinarySignaturePayload> {
    const response = await fetch('/api/uploads/cloudinary-signature', {
        method: 'POST',
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Không thể khởi tạo upload ảnh.');
    }

    return data as CloudinarySignaturePayload;
}

export async function uploadImageDirectToCloudinary(
    file: File,
    signedUpload: CloudinarySignaturePayload
): Promise<DirectCloudinaryUploadResult> {
    const uploadStart = performance.now();
    console.log(`[KYC Upload] Starting upload for ${file.name} (${Math.round(file.size / 1024)} KB)`);

    const { cloudName, apiKey, folder, timestamp, signature } = signedUpload;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('folder', folder);
    formData.append('signature', signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
    });

    const data = await response.json();
    if (!response.ok || !data.secure_url) {
        throw new Error(data.error?.message || 'Tải ảnh lên Cloudinary thất bại.');
    }

    console.log(
        `[KYC Upload] Completed ${file.name} in ${(performance.now() - uploadStart).toFixed(0)}ms`
    );

    return {
        secureUrl: data.secure_url as string,
    };
}
