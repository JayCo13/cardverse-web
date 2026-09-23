import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Gói quét thẻ AI & kiểm tra giá',
  description: 'Mở khóa quét thẻ Pokémon bằng AI không giới hạn, phân tích giá thị trường và trải nghiệm không quảng cáo trên CardVerseHub.',
  path: '/pricing',
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
