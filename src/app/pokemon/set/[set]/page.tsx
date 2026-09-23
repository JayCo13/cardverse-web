import { CatalogSetPage, catalogSetMetadata } from '@/components/seo/catalog-set-page';

// Search parameters make pagination request-dependent; catalog reads use a 1-day data cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params, searchParams }: { params: Promise<{ set: string }>; searchParams: Promise<{ page?: string }> }) {
  const metadata = await catalogSetMetadata((await params).set, 'pokemon');
  const page = Number((await searchParams).page || 1);
  if (page > 1) metadata.robots = { index: false, follow: true };
  return metadata;
}

export default async function Page({ params, searchParams }: { params: Promise<{ set: string }>; searchParams: Promise<{ page?: string }> }) {
  return <CatalogSetPage segment={(await params).set} section="pokemon" page={Number((await searchParams).page || 1)} />;
}
