import { createServerSupabaseClient } from '@/lib/supabase/server';
import { standingFromProfile } from '@/lib/reputation';
import type { ProfileIdentity, ProfileListingCard } from '@/components/profile-view';
import PublicProfileClient from './profile-client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only public columns cross the server/client boundary. Never select contact or payment details. */
export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return <PublicProfileClient userId={id} identity={null} listings={[]} />;

  try {
    const supabase = await createServerSupabaseClient();
    const [profileResult, listingResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, profile_image_url, seller_verified, seller_review_count, created_at, reputation_score, reputation_incidents_90d, reputation_incidents_total, completed_transactions')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('cards')
        .select('id, name, image_url, listing_type, price, last_sold_price, status')
        .eq('seller_id', id)
        .eq('listing_visibility', 'visible')
        .order('created_at', { ascending: false })
        .limit(60),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (listingResult.error) throw listingResult.error;

    const row = profileResult.data as Record<string, unknown> | null;
    if (!row) return <PublicProfileClient userId={id} identity={null} listings={[]} />;

    const identity: ProfileIdentity = {
      displayName: (row.display_name as string | null) ?? null,
      email: null,
      profileImageUrl: (row.profile_image_url as string | null) ?? null,
      sellerVerified: Boolean(row.seller_verified),
      sellerReviewCount: (row.seller_review_count as number | null) ?? 0,
      standing: standingFromProfile(row),
      createdAt: (row.created_at as string | null) ?? null,
    };
    const listings: ProfileListingCard[] = ((listingResult.data as Record<string, unknown>[] | null) ?? []).map((card) => ({
      id: String(card.id),
      name: String(card.name ?? ''),
      imageUrl: (card.image_url as string | null) ?? '',
      listingType: (card.listing_type as string | null) ?? null,
      price: (card.price as number | null) ?? null,
      lastSoldPrice: (card.last_sold_price as number | null) ?? null,
      status: (card.status as string | null) ?? null,
    }));

    return <PublicProfileClient userId={id} identity={identity} listings={listings} />;
  } catch (error) {
    console.error('[PublicProfile] Failed to load public profile:', error);
    throw error;
  }
}
