import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Liên hệ',
  description: 'Liên hệ đội ngũ CardVerseHub qua email, điện thoại hoặc Zalo về mua bán thẻ bài, đơn hàng, thanh toán và hợp tác.',
  path: '/contact',
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
