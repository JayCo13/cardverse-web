import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import {
  catalogProductPath, catalogSetPath, getCachedCatalogGroup, getCachedGroupProducts,
  getCachedPilotGroupHasProduct, referencePrices, type CatalogGroup,
} from '@/lib/seo/catalog';

function parseId(value: string): number | null {
  const match = /^(\d+)(?:-[a-z0-9-]+)?$/.exec(value);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

async function load(segment: string, section: 'pokemon' | 'onepiece'): Promise<CatalogGroup | null> {
  const id = parseId(segment);
  if (!id) return null;
  const group = await getCachedCatalogGroup(id);
  if (!group || (section === 'pokemon' ? ![3, 85].includes(group.category_id) : group.category_id !== 68)) return null;
  return group;
}

export async function catalogSetMetadata(segment: string, section: 'pokemon' | 'onepiece'): Promise<Metadata> {
  const group = await load(segment, section);
  if (!group) return buildMetadata({ title: 'Không tìm thấy bộ thẻ', path: `/${section}/set/${segment}`, noIndex: true });
  // The pilot sitemap lists only groups represented by one of its products.
  const published = await getCachedPilotGroupHasProduct(group);
  return buildMetadata({
    title: `${group.name} – bộ thẻ ${section === 'pokemon' ? 'Pokémon' : 'One Piece'}`,
    description: `Xem danh sách, ảnh và giá thị trường tham khảo của thẻ trong bộ ${group.name}. Giá bán thực tế trên CardVerseHub được hiển thị riêng ở từng listing.`,
    path: catalogSetPath(group), noIndex: !published || `/${section}/set/${segment}` !== catalogSetPath(group),
  });
}

export async function CatalogSetPage({ segment, section, page }: { segment: string; section: 'pokemon' | 'onepiece'; page: number }) {
  const group = await load(segment, section);
  if (!group || !Number.isSafeInteger(page) || page < 1 || page > 1000) notFound();
  const path = catalogSetPath(group);
  if (`/${section}/set/${segment}` !== path) permanentRedirect(path);
  const products = await getCachedGroupProducts(group.group_id, page);
  const items = products.slice(0, 60);
  if (page > 1 && !items.length) notFound();
  const currentPath = page > 1 ? `${path}?page=${page}` : path;

  return <main className="container mx-auto px-4 py-8 space-y-6">
    {page === 1 && <JsonLd data={breadcrumbJsonLd([
      { name: 'Trang chủ', path: '/' },
      { name: section === 'pokemon' ? 'Pokémon' : 'One Piece', path: `/${section}` },
      { name: group.name, path },
    ])} />}
    <nav className="text-sm text-muted-foreground"><Link href={`/${section}`}>{section === 'pokemon' ? 'Pokémon' : 'One Piece'}</Link> / {group.name}</nav>
    <h1 className="text-3xl font-bold">Bộ thẻ {group.name}</h1>
    <p>Thông tin và giá thị trường dưới đây chỉ mang tính tham khảo; giá bán trên CardVerseHub do từng người bán đặt.</p>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {items.map((product) => {
        const prices = product.market_price && product.market_price > 0 ? referencePrices(product.market_price) : null;
        return <Link key={product.product_id} href={catalogProductPath(product)} className="rounded-xl border border-white/10 p-3 hover:border-orange-400">
          <div className="relative aspect-[3/4]">{product.image_url && <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-contain" />}</div>
          <h2 className="mt-3 font-semibold">{product.name}</h2>
          <p className="text-sm text-muted-foreground">{product.number || 'Chưa có số thẻ'} · {product.rarity || 'Chưa rõ độ hiếm'}</p>
          <p className="text-sm">{prices ? `${prices.usd} ≈ ${prices.vnd}` : 'Chưa có giá tham khảo'}</p>
        </Link>;
      })}
    </div>
    <nav className="flex gap-4 text-orange-400">
      {page > 1 && <Link href={page === 2 ? path : `${path}?page=${page - 1}`}>Trang trước</Link>}
      {products.length > 60 && <Link href={`${path}?page=${page + 1}`}>Trang tiếp</Link>}
    </nav>
    <span className="sr-only">{currentPath}</span>
  </main>;
}
