import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { goshipDistricts } from '@/lib/goship';

/**
 * The districts of one city — the level Vietnam abolished in 2025 and the
 * carrier network still runs on. See the note in ../cities.
 */
async function handleGET(request: NextRequest) {
    const cityCode = (request.nextUrl.searchParams.get('city_code') || '').trim();
    if (!/^\d{1,12}$/.test(cityCode)) {
        return NextResponse.json({ error: 'city_code is required' }, { status: 400 });
    }

    const result = await goshipDistricts(cityCode);
    if (!result.ok) {
        console.error('[Address] GoShip districts failed:', result.reason);
        return NextResponse.json({ error: 'Không tải được danh sách quận/huyện.' }, { status: 502 });
    }
    if (result.data.length === 0) {
        return NextResponse.json({ error: 'Unknown city' }, { status: 404 });
    }

    return NextResponse.json(
        { data: result.data.map((d) => ({ code: d.id, name: d.name })) },
        // This response varies by city_code. Netlify's Next.js adapter does
        // not include arbitrary query parameters in its default CDN cache key,
        // so public caching here can serve one city's districts to every city.
        // GoShip responses are already memoised server-side in goship.ts.
        { headers: { 'Cache-Control': 'private, no-store' } },
    );
}

export const GET = accountRoute(handleGET);
