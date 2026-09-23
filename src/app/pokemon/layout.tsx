import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Thẻ bài Pokémon – Giá thị trường & mua bán',
  description: 'Tra giá hơn 27.000 thẻ Pokémon TCG (tiếng Anh và tiếng Nhật) theo set, độ hiếm và giá thị trường. Mua, bán và trả giá thẻ Pokémon tại Việt Nam trên CardVerseHub.',
  path: '/pokemon',
});

export default function PokemonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
