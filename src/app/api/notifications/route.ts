import { accountRoute } from '@/lib/account-route';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type { Database } from '@/lib/supabase/database.types';
type Related = { id: string; buyer_id: string; seller_id: string; card_id: string | null };

// Read through the user's RLS session, including all related records. Never
// accept a recipient id from the browser or use service-role enrichment here.
async function handleGET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase.from('notifications').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
    .returns<Database['public']['Tables']['notifications']['Row'][]>();
  if (error) return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
  const rows = data ?? [];
  const ids = (key: 'order_id' | 'offer_id' | 'conversation_id' | 'card_id') =>
    [...new Set(rows.map(row => row[key]).filter((id): id is string => !!id))];
  const [orders, offers, conversations] = await Promise.all([
    ids('order_id').length ? supabase.from('orders').select('id,buyer_id,seller_id,card_id').in('id', ids('order_id')).returns<Related[]>() : Promise.resolve({ data: [] as Related[] }),
    ids('offer_id').length ? supabase.from('offers').select('id,buyer_id,seller_id,card_id').in('id', ids('offer_id')).returns<Related[]>() : Promise.resolve({ data: [] as Related[] }),
    ids('conversation_id').length ? supabase.from('conversations').select('id,buyer_id,seller_id,card_id').in('id', ids('conversation_id')).returns<Related[]>() : Promise.resolve({ data: [] as Related[] }),
  ]);
  const related = [...(orders.data ?? []), ...(offers.data ?? []), ...(conversations.data ?? [])];
  const profileIds = [...new Set(related.flatMap(row => [row.buyer_id, row.seller_id]).filter((id): id is string => !!id))];
  const cardIds = [...new Set([...ids('card_id'), ...related.map(row => row.card_id).filter((id): id is string => !!id)])];
  const [profiles, cards] = await Promise.all([
    profileIds.length ? supabase.from('profiles').select('id,display_name').in('id', profileIds).returns<{id: string; display_name: string | null}[]>() : Promise.resolve({ data: [] }),
    cardIds.length ? supabase.from('cards').select('id,name').in('id', cardIds).returns<{id: string; name: string}[]>() : Promise.resolve({ data: [] }),
  ]);
  return NextResponse.json({ notifications: rows.map(row => {
    const entity = orders.data?.find(item => item.id === row.order_id)
      ?? offers.data?.find(item => item.id === row.offer_id)
      ?? conversations.data?.find(item => item.id === row.conversation_id);
    const participant = entity && (entity.buyer_id === user.id || entity.seller_id === user.id);
    const role = participant ? (entity.buyer_id === user.id ? 'buyer' : 'seller') : undefined;
    const otherId = participant ? (role === 'buyer' ? entity.seller_id : entity.buyer_id) : undefined;
    // Legacy enrichment is identity only, never current monetary/status data.
    const metadata = {
      recipient_role: role,
      counterparty_name: profiles.data?.find(profile => profile.id === otherId)?.display_name ?? undefined,
      card_name: cards.data?.find(card => card.id === (row.card_id ?? entity?.card_id))?.name ?? undefined,
      ...(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}),
    };
    return { id: row.id, userId: row.user_id, type: row.type, title: row.title,
      message: row.message, orderId: row.order_id, offerId: row.offer_id,
      cardId: row.card_id, conversationId: row.conversation_id,
      transactionId: row.transaction_id, read: row.read, createdAt: row.created_at, metadata };
  }) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// Delete one of the caller's own notifications.
//
// `notifications` has no RLS delete policy on purpose (see
// supabase/migrations/20260702_p0_money_and_notifications.sql), so the row is
// removed through the service-role client — with `user_id` pinned to the
// authenticated caller, never to an id sent by the browser.
async function handleDELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Missing notification id' }, { status: 400 });
  }

  const { error } = await createServiceSupabaseClient()
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not delete notification' }, { status: 500 });

  return NextResponse.json({ success: true });
}

export const GET = accountRoute(handleGET);
export const DELETE = accountRoute(handleDELETE);
