import { NextRequest, NextResponse } from 'next/server';
import { getWards } from '@/lib/ghn';

const cache = new Map<number, { data: Awaited<ReturnType<typeof getWards>>; time: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const districtId = parseInt(searchParams.get('district_id') || '0');

        if (!districtId) {
            return NextResponse.json({ error: 'district_id is required' }, { status: 400 });
        }

        const cached = cache.get(districtId);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            return NextResponse.json({ data: cached.data });
        }

        const wards = await getWards(districtId);
        cache.set(districtId, { data: wards, time: Date.now() });

        return NextResponse.json({ data: wards });
    } catch (error: any) {
        console.error('Get wards error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
