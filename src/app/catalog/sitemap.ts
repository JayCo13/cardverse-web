import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site';
import {
  catalogProductPath, catalogSetPath, getCatalogGroups, getPilotCatalogProducts,
  type CatalogCategoryId,
} from '@/lib/seo/catalog';

export const revalidate = 86400;
const CATEGORIES: CatalogCategoryId[] = [3, 85, 68];

export function generateSitemaps() {
  return CATEGORIES.map((_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const index = Number(await id);
  const category = CATEGORIES[index];
  if (!category) return [];
  const products = await getPilotCatalogProducts(category);
  const groupIds = [...new Set(products.map((product) => product.group_id))];
  const groups = await getCatalogGroups(groupIds);
  return [
    ...groups.map((group) => ({
      url: `${SITE_URL}${catalogSetPath(group)}`,
      lastModified: group.updated_at ? new Date(group.updated_at) : undefined,
    })),
    ...products.map((product) => ({
      url: `${SITE_URL}${catalogProductPath(product)}`,
      lastModified: product.updated_at ? new Date(product.updated_at) : undefined,
    })),
  ];
}
