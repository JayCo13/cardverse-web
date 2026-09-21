import { accountRoute, getAccountRouteContext } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';

type Cursor = { createdAt: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function decodeCursor(value: string | null): Cursor | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
        if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !POSTGRES_TIMESTAMP.test(parsed.createdAt) || !UUID.test(parsed.id) || !Number.isFinite(Date.parse(parsed.createdAt))) return null;
        return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
        return null;
    }
}

function encodeCursor(row: { created_at: string; id: string }): string {
    return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64url');
}

async function handleGET(request: NextRequest) {
    const { supabase, user } = await getAccountRouteContext(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const filter = request.nextUrl.searchParams.get('status') || 'all';
    const limit = Number(request.nextUrl.searchParams.get('limit') || 8);
    const cursorParam = request.nextUrl.searchParams.get('cursor');
    const cursor = decodeCursor(cursorParam);
    if (!['all', 'active', 'sold', 'draft', 'hidden'].includes(filter) || !Number.isSafeInteger(limit) || limit < 1 || limit > 8 || (cursorParam && !cursor)) {
        return NextResponse.json({ error: 'Invalid listing pagination' }, { status: 400 });
    }

    let query = supabase
        .from('cards')
        .select('id, name, image_url, price, status, listing_visibility, listing_type, category, condition, created_at')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);

    if (filter === 'all') query = query.neq('listing_visibility', 'deleted');
    if (filter === 'active') query = query.eq('listing_visibility', 'visible').in('status', ['active', 'in_transaction']);
    if (filter === 'sold') query = query.eq('listing_visibility', 'visible').eq('status', 'sold');
    if (filter === 'draft') query = query.eq('listing_visibility', 'visible').or('status.is.null,status.not.in.(active,in_transaction,sold)');
    if (filter === 'hidden') query = query.eq('listing_visibility', 'hidden');
    if (cursor) {
        query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[Seller listings] Load failed:', error.message);
        return NextResponse.json({ error: 'Không tải được bài đăng.' }, { status: 500 });
    }

    const rows = (data || []) as Array<{ id: string; created_at: string } & Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return NextResponse.json({
        items,
        nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = accountRoute(handleGET);
