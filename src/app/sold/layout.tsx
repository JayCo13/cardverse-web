import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Thẻ đã bán – Giá giao dịch thực tế',
  description: 'Lịch sử các thẻ Pokémon, One Piece và bóng đá đã bán trên CardVerseHub kèm giá chốt thực tế, để tham khảo giá thị trường tại Việt Nam.',
  path: '/sold',
});

export default function SoldLayout({ children }: { children: React.ReactNode }) {
  return children;
}
