import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Thẻ bài One Piece – Giá thị trường & mua bán',
  description: 'Tra giá hơn 18.000 thẻ One Piece Card Game theo set và độ hiếm. Mua, bán và trả giá thẻ One Piece tại Việt Nam trên CardVerseHub.',
  path: '/onepiece',
});

export default function OnePieceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
