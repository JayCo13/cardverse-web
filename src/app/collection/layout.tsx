import { buildMetadata } from '@/lib/seo/metadata';

// Signed-in only; the crawler gets the login gate, so it is not indexed.
export const metadata = buildMetadata({ title: 'Bộ sưu tập của tôi', path: '/collection', noIndex: true });

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
