import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

/**
 * eBay Marketplace Account Deletion/Closure Notification Endpoint
 * 
 * Required by eBay for Growth Check / API rate limit increase.
 * 
 * GET  - Handles eBay's challenge validation (SHA-256 hash response)
 * POST - Acknowledges account deletion notifications with 200 OK
 * 
 * Docs: https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion/marketplace-user-account-deletion
 */

// Set this in your .env file — must be 32-80 chars, alphanumeric + underscore + hyphen only
const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || '';

// Your deployed endpoint URL — must match exactly what you enter in eBay Developer Portal
const ENDPOINT_URL = process.env.EBAY_DELETION_ENDPOINT || 'https://cardversehub.com/api/ebay-deletion';

/**
 * GET handler — eBay Challenge Validation
 * 
 * When you subscribe to notifications, eBay sends:
 *   GET https://<your-url>?challenge_code=<unique_code>
 * 
 * We must respond with SHA-256 hash of: challengeCode + verificationToken + endpoint
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const challengeCode = searchParams.get('challenge_code');

    if (!challengeCode) {
        return NextResponse.json(
            { error: 'Missing challenge_code parameter' },
            { status: 400 }
        );
    }

    if (!VERIFICATION_TOKEN || !ENDPOINT_URL) {
        console.error('❌ Missing EBAY_VERIFICATION_TOKEN or EBAY_DELETION_ENDPOINT env vars');
        return NextResponse.json(
            { error: 'Server configuration error' },
            { status: 500 }
        );
    }

    // Hash: challengeCode + verificationToken + endpoint (order matters!)
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    console.log(`✅ eBay challenge validated for code: ${challengeCode.slice(0, 8)}...`);

    return NextResponse.json(
        { challengeResponse },
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }
    );
}

/**
 * POST handler — Receive Account Deletion Notifications
 * 
 * eBay sends JSON notifications like:
 * {
 *   "metadata": { "topic": "MARKETPLACE_ACCOUNT_DELETION", ... },
 *   "notification": {
 *     "notificationId": "...",
 *     "data": { "username": "...", "userId": "...", "eiasToken": "..." }
 *   }
 * }
 * 
 * We acknowledge with 200 OK. Since we don't store any eBay user data
 * (only use Browse API for searching), no deletion action is needed.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const topic = body?.metadata?.topic;
        const notificationId = body?.notification?.notificationId;
        const userId = body?.notification?.data?.userId;

        console.log(`📩 eBay notification received:`, {
            topic,
            notificationId,
            userId: userId ? `${userId.slice(0, 4)}***` : 'N/A',
            timestamp: new Date().toISOString()
        });

        // Acknowledge receipt — eBay accepts 200, 201, 202, or 204
        return NextResponse.json(
            { status: 'acknowledged', notificationId },
            { status: 200 }
        );

    } catch (error) {
        console.error('❌ Error processing eBay deletion notification:', error);

        // Still return 200 to prevent eBay from retrying
        return NextResponse.json(
            { status: 'acknowledged' },
            { status: 200 }
        );
    }
}
