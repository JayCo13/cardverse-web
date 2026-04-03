import { NextRequest, NextResponse } from 'next/server';
import { getDistricts } from '@/lib/ghn';

// Simple in-memory cache
const cache = new Map<number, { data: Awaited<ReturnType<typeof getDistricts>>; time: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const provinceId = parseInt(searchParams.get('province_id') || '0');

        if (!provinceId) {
            return NextResponse.json({ error: 'province_id is required' }, { status: 400 });
        }

        const cached = cache.get(provinceId);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            return NextResponse.json({ data: cached.data });
        }

        const districts = await getDistricts(provinceId);
        cache.set(provinceId, { data: districts, time: Date.now() });

        return NextResponse.json({ data: districts });
    } catch (error: any) {
        console.error('Get districts error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
