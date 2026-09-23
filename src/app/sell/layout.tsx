import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Bán thẻ bài Pokémon, One Piece, bóng đá',
  description: 'Đăng bán thẻ Pokémon, One Piece và thẻ cầu thủ bóng đá trên CardVerseHub. Nhận tiền qua thanh toán ký quỹ, đơn vị vận chuyển báo giá ship trực tiếp, phí sàn minh bạch.',
  path: '/sell',
});

export default function SellLayout({ children }: { children: React.ReactNode }) {
  return children;
}
