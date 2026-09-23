import Link from 'next/link';
import { catalogProductPath, catalogSetPath, getCachedCatalogPreview, type CatalogCategoryId } from '@/lib/seo/catalog';

export async function CatalogPreviewSection({ categories }: { categories: CatalogCategoryId[] }) {
  const results = await Promise.allSettled(categories.map((id) => getCachedCatalogPreview(id, 8)));
  const products = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!products.length) return null;
  return <section className="container mx-auto px-4 py-10">
    <h2 className="mb-4 text-2xl font-semibold">Khám phá bộ thẻ và giá tham khảo</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((product) => <div className="rounded-lg border border-white/10 p-3" key={product.product_id}>
        <Link className="font-medium text-orange-400 hover:underline" href={catalogProductPath(product)}>{product.name}</Link>
        <p className="text-sm text-muted-foreground"><Link className="hover:underline" href={catalogSetPath({ group_id: product.group_id, category_id: product.category_id, name: product.set_name || 'set' })}>{product.set_name}</Link></p>
      </div>)}
    </div>
  </section>;
}
