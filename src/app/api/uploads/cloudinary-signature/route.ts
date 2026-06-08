import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { createServerSupabaseClient } from '@/lib/supabase/server';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const KYC_UPLOAD_FOLDER = 'cardverse/cards/kyc';
// Folders the client is allowed to request a signature for. The server signs
// only these exact values so a tampered request can't write anywhere else.
const ALLOWED_FOLDERS = new Set(['cardverse/cards', KYC_UPLOAD_FOLDER]);

export async function POST(request: Request) {
    try {
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            return NextResponse.json({ error: 'Cloudinary is not configured on the server.' }, { status: 500 });
        }

        const authClient = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Optional folder from the request body; defaults to the KYC folder so
        // existing callers keep working unchanged.
        let requestedFolder = KYC_UPLOAD_FOLDER;
        try {
            const body = await request.json();
            if (body?.folder && ALLOWED_FOLDERS.has(body.folder)) {
                requestedFolder = body.folder;
            }
        } catch {
            // No/invalid body — keep the default folder.
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const folder = requestedFolder;
        const signature = cloudinary.utils.api_sign_request(
            { folder, timestamp },
            process.env.CLOUDINARY_API_SECRET
        );

        return NextResponse.json({
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey: process.env.CLOUDINARY_API_KEY,
            folder,
            timestamp,
            signature,
        });
    } catch (error: any) {
        console.error('Create Cloudinary signature error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
