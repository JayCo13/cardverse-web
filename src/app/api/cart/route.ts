import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';

type CartCard = {
  id: string;
  seller_id: string;
  status: string;
  listing_type: string | null;
};

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getRouteUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.nextUrl.searchParams.get('view') === 'count') {
    const { count, error } = await supabase.from('cart_items')
      .select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ count: count || 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      *,
      cards:card_id(
        *,
        profiles:seller_id(
          display_name,
          profile_image_url,
          seller_verified,
          address_district_id,
          address_ward_code,
          shipping_carriers,
          shipping_fees
        )
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { card_id } = await request.json();
  if (!card_id) {
    return NextResponse.json({ error: 'card_id is required' }, { status: 400 });
  }

  const { data: card, error: cardError } = await supabase
    .from('cards')
    .select('id, seller_id, status, listing_type')
    .eq('id', card_id)
    .single<CartCard>();

  if (cardError || !card) {
    return NextResponse.json({ error: 'Không tìm thấy thẻ.' }, { status: 404 });
  }

  if (card.seller_id === user.id) {
    return NextResponse.json({ error: 'Bạn không thể thêm bài đăng của chính mình vào giỏ hàng.' }, { status: 400 });
  }

  if (card.status !== 'active' || card.listing_type !== 'sale') {
    return NextResponse.json({ error: 'Thẻ này không còn khả dụng để thêm vào giỏ hàng.', code: 'card_unavailable' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('cart_items')
    .upsert({
      user_id: user.id,
      card_id,
      quantity: 1,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: 'user_id,card_id' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count } = await supabase
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return NextResponse.json({ item: data, count: count || 0 });
}

/**
 * Remove several rows in one call: `{ ids: [...] }` clears a selection, and a
 * request with no ids empties the cart.
 *
 * Every variant is scoped to the caller's own rows, so an id belonging to
 * someone else's cart simply matches nothing rather than deleting it. The
 * removed ids come back so the client can reconcile without refetching.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let ids: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((id: unknown): id is string => typeof id === 'string');
    }
  } catch {
    // No body at all is the "empty the cart" case.
  }

  // An explicit but empty list is a caller bug; letting it through would wipe
  // the whole cart, which is the opposite of what was asked.
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: 'No cart items given' }, { status: 400 });
  }

  let query = supabase.from('cart_items').delete().eq('user_id', user.id);
  if (ids) query = query.in('id', ids);

  // The generated row type for a delete().select() narrows to `never`, so the
  // shape is asserted here rather than threaded through database.types.ts.
  const { data, error } = await query.select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const removed = ((data || []) as unknown as { id: string }[]).map(row => row.id);

  return NextResponse.json({ success: true, removed });
}
