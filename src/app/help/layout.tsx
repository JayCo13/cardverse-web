import { buildMetadata } from '@/lib/seo/metadata';

export const metadata = buildMetadata({
  title: 'Trung tâm trợ giúp – Câu hỏi thường gặp',
  description: 'Cách mua thẻ, bán thẻ, trả giá, thanh toán ký quỹ, vận chuyển và hoàn tiền trên CardVerseHub. 15 câu hỏi thường gặp được giải đáp.',
  path: '/help',
});

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
