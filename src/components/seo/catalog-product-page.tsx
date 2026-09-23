import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import { SITE_URL } from '@/lib/seo/site';
import {
  catalogAttributes, catalogProductPath, catalogSetPath, getCatalogListings,
  getCachedCatalogProduct, publishedCatalogProduct, referencePrices,
  type CatalogCategoryId, type CatalogProduct,
} from '@/lib/seo/catalog';
import ProductDetailClient, { type ProductCard } from '@/app/products/[id]/product-detail-client';

function parseId(segment: string): number | null {
  const match = /^(\d+)(?:-[a-z0-9-]+)?$/.exec(segment);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

async function load(segment: string, section: 'pokemon' | 'onepiece'): Promise<CatalogProduct | null> {
  const id = parseId(segment);
  if (!id) return null;
  const product = await getCachedCatalogProduct(id);
  if (!product) return null;
  if (section === 'pokemon' ? ![3, 85].includes(product.category_id) : product.category_id !== 68) return null;
  return product;
}

export async function catalogProductMetadata(segment: string, section: 'pokemon' | 'onepiece'): Promise<Metadata> {
  const product = await load(segment, section);
  if (!product) return buildMetadata({ title: 'Không tìm thấy thẻ', path: `/${section}/card/${segment}`, noIndex: true });
  const prices = product.market_price && product.market_price > 0 ? referencePrices(product.market_price) : null;
  return buildMetadata({
    title: `${product.name} – ${product.set_name || 'Thẻ bài'}${prices ? ` – ${prices.usd}` : ''}`,
    description: `${product.name}${product.number ? ` #${product.number}` : ''} thuộc ${product.set_name || 'catalog'}; giá thị trường tham khảo${prices ? ` ${prices.usd} (khoảng ${prices.vnd})` : ' chưa có'}. Xem thông tin và thẻ đang bán trên CardVerseHub.`,
    path: catalogProductPath(product),
    image: product.image_url || undefined,
    imageAlt: product.name,
    noIndex: !publishedCatalogProduct(product) || `/${section}/card/${segment}` !== catalogProductPath(product),
  });
}

export async function CatalogProductPage({ segment, section }: { segment: string; section: 'pokemon' | 'onepiece' }) {
  const product = await load(segment, section);
  if (!product) notFound();
  const path = catalogProductPath(product);
  if (`/${section}/card/${segment}` !== path) permanentRedirect(path);

  const listings = await getCatalogListings(product.product_id);
  const cheapestListing = listings.find((item) => item.price != null && item.price > 0) ?? null;
  const prices = product.market_price && product.market_price > 0 ? referencePrices(product.market_price) : null;
  const attributes = catalogAttributes(product.extended_data);
  const setPath = catalogSetPath({ group_id: product.group_id, category_id: product.category_id, name: product.set_name || 'set' });
  const data: ProductCard = {
    product_id: product.product_id,
    title: product.name,
    image_url: product.image_url,
    market_price: product.market_price,
    low_price: product.low_price,
    mid_price: product.mid_price,
    high_price: product.high_price,
    rarity: product.rarity,
    category: product.set_name,
    set_name: product.set_name,
    category_id: product.category_id,
    number: product.number,
  };

  return <>
    {publishedCatalogProduct(product) && <JsonLd data={[
      {
        '@context': 'https://schema.org', '@type': 'Product', name: product.name,
        image: product.image_url || undefined, sku: String(product.product_id),
        description: `${product.name} — ${product.set_name || ''}${product.number ? ` #${product.number}` : ''}. Giá thị trường chỉ mang tính tham khảo.`,
        offers: cheapestListing ? {
          '@type': 'Offer', url: `${SITE_URL}/cards/${cheapestListing.id}`,
          price: cheapestListing.price, priceCurrency: 'VND',
          availability: 'https://schema.org/InStock',
        } : undefined,
      },
      breadcrumbJsonLd([
        { name: 'Trang chủ', path: '/' },
        { name: section === 'pokemon' ? 'Pokémon' : 'One Piece', path: `/${section}` },
        { name: product.set_name || 'Bộ thẻ', path: setPath },
        { name: product.name, path },
      ]),
    ]} />}
    <ProductDetailClient productId={product.product_id} initialCard={data} />
    <section className="container mx-auto px-4 pb-12 space-y-5">
      <p>Giá thị trường tham khảo: {prices ? `${prices.usd} (khoảng ${prices.vnd})` : 'chưa có dữ liệu'}. Không phải giá chào bán trên CardVerseHub.</p>
      <Link className="text-orange-400 underline" href={setPath}>Xem bộ {product.set_name || 'thẻ'}</Link>
      {attributes.length > 0 && <div><h2 className="text-xl font-semibold mb-2">Thông tin thẻ</h2><dl className="grid gap-2 sm:grid-cols-2">{attributes.map((attribute, index) => <div key={`${attribute.name}-${index}`}><dt className="text-sm text-muted-foreground">{attribute.name}</dt><dd>{attribute.value}</dd></div>)}</dl></div>}
      <div><h2 className="text-xl font-semibold mb-2">Đang bán trên CardVerseHub</h2>
        {listings.length ? <ul className="space-y-2">{listings.map((listing) => <li key={listing.id}><Link className="text-orange-400 underline" href={`/cards/${listing.id}`}>{listing.name}{listing.price != null ? ` – ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(listing.price)}` : ''}</Link></li>)}</ul> : <p>Hiện chưa có thẻ này đang bán.</p>}
      </div>
      <Link className="inline-block text-orange-400 underline" href="/sell">Bán thẻ này</Link>
    </section>
  </>;
}
