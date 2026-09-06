import { NextResponse } from 'next/server';
import { listProvinces } from '@/lib/vn-address';

/**
 * The 34 provinces, from the dataset vendored in this repo.
 *
 * No upstream call and nothing to fail, so this is a static response cached at
 * the edge for a day. The list changes when the National Assembly says so, and
 * `npm run data:address` is what moves it.
 */
export async function GET() {
    return NextResponse.json(
        { data: listProvinces() },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}
