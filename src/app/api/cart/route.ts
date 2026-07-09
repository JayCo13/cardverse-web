import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type CartCard = {
  id: string;
  seller_id: string;
  status: string;
  listing_type: string | null;
};

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
