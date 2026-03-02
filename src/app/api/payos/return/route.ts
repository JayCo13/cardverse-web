import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const orderCode = searchParams.get('orderCode');

    // IMPORTANT: Use NEXT_PUBLIC_APP_URL, NOT request.nextUrl.origin.
    // On Netlify, request.nextUrl.origin returns the deploy preview URL
    // (e.g. 69a5...--sprightly-beignet-43a900.netlify.app) instead of
    // the custom domain (cardversehub.com), which breaks auth cookies
    // and shows the wrong domain to users.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    if (status === 'success') {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=success&orderCode=${orderCode}`);
    } else {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=cancelled&orderCode=${orderCode}`);
    }
}
