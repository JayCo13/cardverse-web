import { catalogProductPath, getCatalogProduct } from '@/lib/seo/catalog';
import { SITE_URL } from '@/lib/seo/site';

/** A real HTTP redirect keeps old product links from competing with the new canonical. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response('Not found', { status: 404 });
  const product = await getCatalogProduct(Number(id));
  if (!product || ![3, 85, 68].includes(product.category_id)) return new Response('Not found', { status: 404 });
  return Response.redirect(new URL(catalogProductPath(product), SITE_URL), 308);
}
