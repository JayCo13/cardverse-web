import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Cơ chế khiếu nại',
  description: 'Quy trình khiếu nại và giải quyết tranh chấp giữa người mua và người bán trên CardVerseHub, với tiền được giữ ký quỹ cho tới khi xử lý xong.',
  path: '/complaints',
});

export default function ComplaintsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
