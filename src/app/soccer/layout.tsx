import { buildMetadata } from '@/lib/seo/metadata';

// Force dynamic rendering for this route — the page uses useSearchParams()
export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: 'Thẻ cầu thủ bóng đá – Topps, Panini',
  description: 'Mua bán thẻ cầu thủ bóng đá Topps, Panini, Match Attax tại Việt Nam. Kiểm tra giá thị trường và giao dịch an toàn qua ký quỹ trên CardVerseHub.',
  path: '/soccer',
});

export default function SoccerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
