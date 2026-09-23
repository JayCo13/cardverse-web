/** URL and pilot rules shared by server-rendered catalog pages and client grids. */
export const CATALOG_CATEGORIES = { 3: 'pokemon', 85: 'pokemon', 68: 'onepiece' } as const;
export type CatalogCategoryId = keyof typeof CATALOG_CATEGORIES;

export const PILOT_MAX_ID: Record<CatalogCategoryId, number> = { 3: 84117, 85: 566767, 68: 510578 };
export const PILOT_MIN_ID: Record<CatalogCategoryId, number> = { 3: 42346, 85: 565756, 68: 288228 };

export function catalogSlug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'card';
}

export function catalogProductPath(product: { product_id: number; category_id: number; name: string }): string {
  const section = CATALOG_CATEGORIES[product.category_id as CatalogCategoryId];
  return section ? `/${section}/card/${product.product_id}-${catalogSlug(product.name)}` : `/products/${product.product_id}`;
}

export function catalogSetPath(group: { group_id: number; category_id: number; name: string }): string {
  const section = CATALOG_CATEGORIES[group.category_id as CatalogCategoryId];
  return `/${section}/set/${group.group_id}-${catalogSlug(group.name)}`;
}

export function isPilotCatalogId(categoryId: number, productId: number): boolean {
  const maxId = PILOT_MAX_ID[categoryId as CatalogCategoryId];
  const minId = PILOT_MIN_ID[categoryId as CatalogCategoryId];
  return Boolean(minId && maxId && productId >= minId && productId <= maxId);
}
