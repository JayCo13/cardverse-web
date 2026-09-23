import Link from 'next/link';
import { buildMetadata } from '@/lib/seo/metadata';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import { ORGANIZATION, SITE_DESCRIPTION_VI, SITE_NAME, socialProfiles } from '@/lib/seo/site';

/**
 * The entity page: who CardVerseHub is, in one paragraph an answer engine can
 * quote, followed by the facts they cross-check (what is sold, how money moves,
 * where the company is). The lead paragraph is the same sentence as the site
 * description, and is what the social bios should say as well.
 */
export const metadata = buildMetadata({
  title: 'Giới thiệu',
  description: SITE_DESCRIPTION_VI,
  path: '/about',
});

const FACTS: { label: string; value: string }[] = [
  { label: 'Sản phẩm', value: 'Thẻ Pokémon TCG (tiếng Anh, tiếng Nhật), One Piece Card Game, thẻ cầu thủ bóng đá (Topps, Panini, Match Attax) và phụ kiện.' },
  { label: 'Cách mua', value: 'Mua ngay hoặc trả giá trực tiếp với người bán. Thanh toán bằng ví CardVerseHub hoặc chuyển khoản / QR qua PayOS.' },
  { label: 'Ký quỹ', value: 'Tiền được sàn giữ cho tới khi người mua xác nhận đã nhận hàng hoặc hết 72 giờ sau khi hãng xác nhận giao thành công mà không có khiếu nại. Đơn có tranh chấp được xem xét trước khi giải ngân.' },
  { label: 'Vận chuyển', value: 'Phí vận chuyển được báo trước khi thanh toán; người mua chọn trong các hãng khả dụng cho tuyến giao hàng.' },
  { label: 'Người bán', value: 'Phải xác minh danh tính và tài khoản ngân hàng trước khi đăng bán. Đăng bán miễn phí; phí 10% chỉ tính khi rút tiền về ngân hàng.' },
  { label: 'Tra giá', value: 'Giá thị trường của hơn 27.000 thẻ Pokémon và 18.000 thẻ One Piece, cập nhật theo TCGplayer, cùng lịch sử thẻ đã bán trên sàn.' },
];

export default function AboutPage() {
  const socials = socialProfiles();
  const address = `${ORGANIZATION.address.streetAddress}, ${ORGANIZATION.address.addressLocality}, ${ORGANIZATION.address.addressRegion}`;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <JsonLd data={breadcrumbJsonLd([{ name: 'Trang chủ', path: '/' }, { name: 'Giới thiệu', path: '/about' }])} />
      <main className="container mx-auto flex-1 px-4 py-16">
        <article className="mx-auto max-w-3xl space-y-12">
          <header className="space-y-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight">{SITE_NAME} là gì?</h1>
            <p className="text-lg text-muted-foreground">{SITE_DESCRIPTION_VI}</p>
          </header>

          <section aria-labelledby="about-how" className="space-y-6">
            <h2 id="about-how" className="text-2xl font-semibold">{SITE_NAME} hoạt động như thế nào</h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              {FACTS.map((fact) => (
                <div key={fact.label} className="rounded-xl border border-border/50 bg-card/50 p-5">
                  <dt className="mb-1 font-semibold">{fact.label}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="about-contact" className="space-y-4">
            <h2 id="about-contact" className="text-2xl font-semibold">Liên hệ</h2>
            <address className="space-y-1 not-italic text-muted-foreground">
              <p>{ORGANIZATION.legalName}</p>
              <p>{address}, Việt Nam</p>
              <p>Email: <a className="text-foreground underline-offset-4 hover:underline" href={`mailto:${ORGANIZATION.email}`}>{ORGANIZATION.email}</a></p>
              <p>Điện thoại: <a className="text-foreground underline-offset-4 hover:underline" href={`tel:${ORGANIZATION.phone.replace(/\s+/g, '')}`}>{ORGANIZATION.phone}</a></p>
              {socials.length > 0 && (
                <p>
                  Mạng xã hội:{' '}
                  {socials.map((url, index) => (
                    <span key={url}>
                      {index > 0 && ' · '}
                      <a className="text-foreground underline-offset-4 hover:underline" href={url} rel="me noopener" target="_blank">{new URL(url).hostname.replace(/^www\./, '')}</a>
                    </span>
                  ))}
                </p>
              )}
            </address>
          </section>

          <nav aria-label="Trang liên quan" className="flex flex-wrap gap-3 text-sm">
            <Link href="/buy" className="rounded-full border border-border/60 px-4 py-2 transition-colors hover:border-primary hover:text-primary">Mua thẻ</Link>
            <Link href="/sell" className="rounded-full border border-border/60 px-4 py-2 transition-colors hover:border-primary hover:text-primary">Bán thẻ</Link>
            <Link href="/help" className="rounded-full border border-border/60 px-4 py-2 transition-colors hover:border-primary hover:text-primary">Câu hỏi thường gặp</Link>
            <Link href="/terms" className="rounded-full border border-border/60 px-4 py-2 transition-colors hover:border-primary hover:text-primary">Điều khoản</Link>
          </nav>
        </article>
      </main>
    </div>
  );
}
