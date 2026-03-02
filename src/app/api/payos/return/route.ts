import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    // PayOS appends its own query params to the return/cancel URLs:
    //   ?code=00&id=<linkId>&cancel=false&status=PAID&orderCode=<code>
    // We check PayOS-native params instead of custom ones.
    const cancel = searchParams.get('cancel');
    const code = searchParams.get('code');
    const payosStatus = searchParams.get('status');
    const orderCode = searchParams.get('orderCode');

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    // Payment is successful when: cancel !== 'true' AND (code === '00' OR status === 'PAID')
    const isSuccess = cancel !== 'true' && (code === '00' || payosStatus === 'PAID');

    if (isSuccess) {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=success&orderCode=${orderCode}`);
    } else {
        return NextResponse.redirect(`${baseUrl}/pricing?payment=cancelled&orderCode=${orderCode}`);
    }
}
