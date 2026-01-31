'use server';

import { v2 as cloudinary } from 'cloudinary';

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

        // Convert File to base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = buffer.toString('base64');
        const dataUri = `data:${file.type};base64,${base64}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataUri, {
            folder: 'cardverse/cards',
            resource_type: 'image',
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
