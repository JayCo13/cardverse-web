import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const orderCode = searchParams.get('orderCode');

    const baseUrl = request.nextUrl.origin;

    if (status === 'success') {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=success&orderCode=${orderCode}`);
    } else {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=cancelled&orderCode=${orderCode}`);
    }
}
