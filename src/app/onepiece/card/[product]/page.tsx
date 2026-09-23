import { CatalogProductPage, catalogProductMetadata } from '@/components/seo/catalog-product-page';

// Render live marketplace offers on every request; catalog details use a separate 1-day data cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ product: string }> }) {
  return catalogProductMetadata((await params).product, 'onepiece');
}

export default async function Page({ params }: { params: Promise<{ product: string }> }) {
  return <CatalogProductPage segment={(await params).product} section="onepiece" />;
}
