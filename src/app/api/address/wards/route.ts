import { NextRequest, NextResponse } from 'next/server';
import { listWards } from '@/lib/vn-address';

/**
 * The wards of one province. Ward is the level below province now — there is no
 * district between them any more.
 *
 * Served per province rather than all 3,321 at once: the whole set is 213KB and
 * a picker only ever needs the one province in front of the reader.
 */
export async function GET(request: NextRequest) {
    const provinceCode = Number(request.nextUrl.searchParams.get('province_code'));
    if (!Number.isSafeInteger(provinceCode) || provinceCode <= 0) {
        return NextResponse.json({ error: 'province_code is required' }, { status: 400 });
    }

    const wards = listWards(provinceCode);
    // An unknown province is a client mistake, not an empty province: every real
    // one has wards, which the refresh script checks before writing the file.
    if (wards.length === 0) {
        return NextResponse.json({ error: 'Unknown province' }, { status: 404 });
    }

    return NextResponse.json(
        { data: wards },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}
