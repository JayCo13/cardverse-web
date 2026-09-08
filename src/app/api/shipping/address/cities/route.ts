import { accountRoute } from '@/lib/account-route';
import { NextResponse } from 'next/server';
import { goshipCities } from '@/lib/goship';

/**
 * The carrier network's geography, level one of three.
 *
 * Deliberately not the same list as /api/address/provinces. That one serves the
 * 2025 structure this country actually has — 34 provinces, no districts. GoShip
 * still models the pre-2025 one, 63 provinces with districts under them, and a
 * courier booked through GoShip is routed by GoShip's idea of where places are.
 *
 * Translating between the two by name is what must never happen: Ho Chi Minh
 * City now contains wards named Bà Rịa and Vũng Tàu that GoShip still files
 * under a province of their own, so a name match would book a pickup in the
 * wrong city and report success. Addresses meant for a courier are collected in
 * the courier's own geography, start to finish, and stored as its ids.
 *
 * Proxied rather than called from the browser because the API token must not
 * leave the server, and cached hard because provinces do not move.
 */
async function handleGET() {
    const result = await goshipCities();
    if (!result.ok) {
        console.error('[Address] GoShip cities failed:', result.reason);
        return NextResponse.json({ error: 'Không tải được danh sách tỉnh/thành.' }, { status: 502 });
    }

    return NextResponse.json(
        { data: result.data.map((c) => ({ code: c.id, name: c.name })) },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}

export const GET = accountRoute(handleGET);
