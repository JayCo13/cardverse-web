import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { accountRoute, getAccountRouteContext } from '@/lib/account-route';
import { mapSaleCard } from '@/app/buy/map-sale-card';

const list = z.array(z.string().max(200)).max(100).optional();
const filtersSchema = z.object({
  search: z.string().max(200).optional(), productKind: z.string().max(30).optional(),
  categories: list, conditions: list, publishers: list, sets: list,
  minPrice: z.union([z.literal(''),z.coerce.number().finite().nonnegative()]).optional(),
  maxPrice: z.union([z.literal(''),z.coerce.number().finite().nonnegative()]).optional(),
  acceptsOffers: z.boolean().optional(), verifiedSellers: z.boolean().optional(),
  bundlesOnly: z.boolean().optional(), gradedOnly: z.boolean().optional(),
});
async function handleGET(request: NextRequest) {
  const { supabase, user } = await getAccountRouteContext(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let filters;
  try { filters = filtersSchema.parse(JSON.parse(request.nextUrl.searchParams.get('filters') || '{}')); }
  catch { return NextResponse.json({ error: 'Invalid filters' }, { status: 400 }); }
  const page = Number(request.nextUrl.searchParams.get('page') || 1);
  const sort = request.nextUrl.searchParams.get('sort') || 'newest';
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !['newest','price-asc','price-desc'].includes(sort)) {
    return NextResponse.json({ error: 'Invalid pagination' }, { status: 400 });
  }
  const { data, error } = await supabase.rpc('marketplace_catalog_page' as never, { p_filters: filters, p_sort: sort, p_page: page } as never);
  if (error) return NextResponse.json({ error: 'Catalog unavailable' }, { status: 503 });
  const result = data as unknown as { rows: unknown[]; count: number; total: number; page: number; facets: unknown };
  return NextResponse.json({ ...result, rows: undefined, cards: result.rows.map(mapSaleCard) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export const GET = accountRoute(handleGET);
