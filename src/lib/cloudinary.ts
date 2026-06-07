'use server';

import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary with environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface UploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

/**
 * Uploads an image to Cloudinary
 * @param formData - FormData containing the image file
 * @returns Promise with the upload result including the image URL
 */
export async function uploadImageToCloudinary(formData: FormData): Promise<UploadResult> {
    try {
        const file = formData.get('file') as File;

        if (!file) {
            return { success: false, error: 'No file provided' };
        }

        // Stream the raw file bytes to Cloudinary to avoid the base64 memory spike
        // that makes large HEIC uploads slow and unstable.
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'cardverse/cards',
                    resource_type: 'image',
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    if (!result?.secure_url) {
                        reject(new Error('Cloudinary did not return a secure URL'));
                        return;
                    }

                    resolve({ secure_url: result.secure_url });
                }
            );

            Readable.from(buffer).pipe(uploadStream);
        });

        return {
            success: true,
            url: result.secure_url,
        };
    } catch (error: any) {
        console.error('Cloudinary upload error:', error);
        return {
            success: false,
            error: error.message || 'Failed to upload image',
        };
    }
}
