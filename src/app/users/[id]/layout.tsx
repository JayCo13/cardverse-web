import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildMetadata } from '@/lib/seo/metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A seller's public shop page gets its own title; anyone who is not a verified
 * seller has nothing public to show and stays out of the index.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const fallback = buildMetadata({ title: 'Người dùng', path: `/users/${id}`, noIndex: true });
  if (!UUID.test(id)) return fallback;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from('profiles')
      .select('display_name, seller_verified, profile_image_url, seller_review_count')
      .eq('id', id)
      .maybeSingle<{ display_name: string | null; seller_verified: boolean | null; profile_image_url: string | null; seller_review_count: number | null }>();
    const name = data?.display_name?.trim();
    if (!data || !name) return fallback;
    return buildMetadata({
      title: `${name} – Gian hàng thẻ bài`,
      description: `Xem các thẻ Pokémon, One Piece và bóng đá đang bán bởi ${name} trên CardVerseHub${data.seller_verified ? ' — người bán đã xác minh danh tính' : ''}. Trả giá và mua an toàn qua ký quỹ.`,
      path: `/users/${id}`,
      image: data.profile_image_url || undefined,
      imageAlt: name,
      noIndex: !data.seller_verified,
    });
  } catch {
    return fallback;
  }
}

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return children;
}
