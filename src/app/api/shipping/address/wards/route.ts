import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { goshipWards } from '@/lib/goship';

/**
 * The wards of one district. Keyed by district, not by province: GoShip nests
 * wards under districts, where /api/address/wards nests them under provinces
 * because the 2025 structure has nothing in between. The two are not
 * interchangeable — see the note in ../cities.
 */
async function handleGET(request: NextRequest) {
    const districtCode = (request.nextUrl.searchParams.get('district_code') || '').trim();
    if (!/^\d{1,12}$/.test(districtCode)) {
        return NextResponse.json({ error: 'district_code is required' }, { status: 400 });
    }

    const result = await goshipWards(districtCode);
    if (!result.ok) {
        console.error('[Address] GoShip wards failed:', result.reason);
        return NextResponse.json({ error: 'Không tải được danh sách phường/xã.' }, { status: 502 });
    }
    if (result.data.length === 0) {
        return NextResponse.json({ error: 'Unknown district' }, { status: 404 });
    }

    return NextResponse.json(
        { data: result.data.map((w) => ({ code: String(w.id), name: w.name })) },
        // This response varies by district_code. Keep it out of Netlify's
        // shared cache or the first district requested can populate every
        // other district's ward list. goship.ts already caches the upstream.
        { headers: { 'Cache-Control': 'private, no-store' } },
    );
}

export const GET = accountRoute(handleGET);
