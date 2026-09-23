import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Điều khoản dịch vụ',
  description: 'Điều khoản sử dụng sàn giao dịch thẻ bài CardVerseHub: vai trò của sàn, thanh toán ký quỹ, phí, vận chuyển, khiếu nại và trách nhiệm các bên.',
  path: '/terms',
});

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
