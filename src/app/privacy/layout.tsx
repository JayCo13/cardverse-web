import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Chính sách bảo mật',
  description: 'CardVerseHub thu thập, sử dụng và bảo vệ dữ liệu cá nhân của bạn như thế nào khi mua bán thẻ bài trên sàn.',
  path: '/privacy',
});

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
