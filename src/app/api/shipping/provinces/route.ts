import { NextResponse } from 'next/server';
import { getProvinces } from '@/lib/ghn';

// Cache provinces for 24h (they rarely change)
let cachedProvinces: Awaited<ReturnType<typeof getProvinces>> | null = null;
let cacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export async function GET() {
    try {
        if (cachedProvinces && Date.now() - cacheTime < CACHE_TTL) {
            return NextResponse.json({ data: cachedProvinces });
        }

        const provinces = await getProvinces();
        cachedProvinces = provinces;
        cacheTime = Date.now();

        return NextResponse.json({ data: provinces });
    } catch (error: any) {
        console.error('Get provinces error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
