import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { USD_TO_VND_RATE } from '@/lib/exchange-rate';
import { PILOT_MAX_ID, PILOT_MIN_ID, isPilotCatalogId, type CatalogCategoryId } from './catalog-path';
export { CATALOG_CATEGORIES, PILOT_MAX_ID, PILOT_MIN_ID, catalogProductPath, catalogSetPath } from './catalog-path';
export type { CatalogCategoryId } from './catalog-path';
export type CatalogProduct = {
  product_id: number;
  category_id: number;
  group_id: number;
  name: string;
  image_url: string | null;
  set_name: string | null;
  number: string | null;
  rarity: string | null;
  market_price: number | null;
  low_price: number | null;
  mid_price: number | null;
  high_price: number | null;
  extended_data: unknown;
  updated_at: string | null;
};
export type CatalogGroup = { group_id: number; category_id: number; name: string; updated_at: string | null };


export function eligibleCatalogProduct(product: CatalogProduct): boolean {
  return Boolean(product.name.trim() && product.set_name?.trim() && product.image_url?.trim() && Number(product.market_price) > 0);
}

export function publishedCatalogProduct(product: CatalogProduct): boolean {
  return isPilotCatalogId(product.category_id, product.product_id) && eligibleCatalogProduct(product);
}

export function referencePrices(usd: number): { usd: string; vnd: string } {
  return {
    usd: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd),
    vnd: new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(usd * USD_TO_VND_RATE),
  };
}

export function catalogAttributes(raw: unknown): { name: string; value: string }[] {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.displayName === 'string' && typeof item.value === 'string')
      .map((item) => ({ name: item.displayName as string, value: item.value as string }))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function catalogClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getCatalogProduct(id: number): Promise<CatalogProduct | null> {
  const { data, error } = await catalogClient().from('tcgcsv_products')
    .select('product_id,category_id,group_id,name,image_url,set_name,number,rarity,market_price,low_price,mid_price,high_price,extended_data,updated_at')
    .eq('product_id', id).maybeSingle();
  if (error) throw error;
  return data as CatalogProduct | null;
}

export const getCachedCatalogProduct = unstable_cache(
  (id: number) => getCatalogProduct(id),
  ['catalog-product'],
  { revalidate: 86400 },
);

export async function getCatalogGroup(id: number): Promise<CatalogGroup | null> {
  const { data, error } = await catalogClient().from('tcgcsv_groups')
    .select('group_id,category_id,name,updated_at').eq('group_id', id).maybeSingle();
  if (error) throw error;
  return data as CatalogGroup | null;
}

export const getCachedCatalogGroup = unstable_cache(
  (id: number) => getCatalogGroup(id),
  ['catalog-group'],
  { revalidate: 86400 },
);

export async function getCatalogGroups(ids: number[]): Promise<CatalogGroup[]> {
  if (!ids.length) return [];
  const { data, error } = await catalogClient().from('tcgcsv_groups')
    .select('group_id,category_id,name,updated_at').in('group_id', ids);
  if (error) throw error;
  return (data ?? []) as CatalogGroup[];
}

export async function getGroupProducts(groupId: number, page: number): Promise<CatalogProduct[]> {
  const start = (page - 1) * 60;
  const { data, error } = await catalogClient().from('tcgcsv_products')
    .select('product_id,category_id,group_id,name,image_url,set_name,number,rarity,market_price,low_price,mid_price,high_price,extended_data,updated_at')
    .eq('group_id', groupId).order('product_id').range(start, start + 60);
  if (error) throw error;
  return (data ?? []) as CatalogProduct[];
}

export const getCachedGroupProducts = unstable_cache(
  (groupId: number, page: number) => getGroupProducts(groupId, page),
  ['catalog-group-products'],
  { revalidate: 86400 },
);

export async function getPilotCatalogProducts(categoryId: CatalogCategoryId): Promise<CatalogProduct[]> {
  const { data, error } = await catalogClient().from('tcgcsv_products')
    .select('product_id,category_id,group_id,name,image_url,set_name,number,rarity,market_price,low_price,mid_price,high_price,extended_data,updated_at')
    .eq('category_id', categoryId).gte('product_id', PILOT_MIN_ID[categoryId]).lte('product_id', PILOT_MAX_ID[categoryId])
    .order('product_id').limit(1000);
  if (error) throw error;
  return ((data ?? []) as CatalogProduct[]).filter(eligibleCatalogProduct);
}

export async function getCatalogPreview(categoryId: CatalogCategoryId, limit = 8): Promise<CatalogProduct[]> {
  const { data, error } = await catalogClient().from('tcgcsv_products')
    .select('product_id,category_id,group_id,name,image_url,set_name,number,rarity,market_price,low_price,mid_price,high_price,extended_data,updated_at')
    .eq('category_id', categoryId).gte('product_id', PILOT_MIN_ID[categoryId])
    .lte('product_id', PILOT_MAX_ID[categoryId]).order('product_id').limit(limit);
  if (error) throw error;
  return ((data ?? []) as CatalogProduct[]).filter(eligibleCatalogProduct);
}

export const getCachedCatalogPreview = unstable_cache(
  (categoryId: CatalogCategoryId, limit: number) => getCatalogPreview(categoryId, limit),
  ['catalog-preview'],
  { revalidate: 86400 },
);

export async function pilotGroupHasProduct(group: CatalogGroup): Promise<boolean> {
  const maxId = PILOT_MAX_ID[group.category_id as CatalogCategoryId];
  if (!maxId) return false;
  const { data, error } = await catalogClient().from('tcgcsv_products')
    .select('product_id').eq('group_id', group.group_id).gte('product_id', PILOT_MIN_ID[group.category_id as CatalogCategoryId]).lte('product_id', maxId)
    .not('image_url', 'is', null).not('set_name', 'is', null)
    .gt('market_price', 0).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export const getCachedPilotGroupHasProduct = unstable_cache(
  (group: CatalogGroup) => pilotGroupHasProduct(group),
  ['catalog-pilot-group'],
  { revalidate: 86400 },
);

export type CatalogListing = { id: string; name: string; price: number | null; listing_type: string | null };
export async function getCatalogListings(productId: number): Promise<CatalogListing[]> {
  const { data, error } = await catalogClient().from('cards')
    .select('id,name,price,listing_type').eq('catalog_product_id', productId)
    .eq('status', 'active').eq('listing_visibility', 'visible')
    .eq('listing_type', 'sale').gt('price', 0)
    .order('price', { ascending: true }).limit(10);
  if (error) throw error;
  return (data ?? []) as CatalogListing[];
}
