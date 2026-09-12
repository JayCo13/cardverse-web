import { NextRequest, NextResponse } from 'next/server';
import { accountRoute } from '@/lib/account-route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { goshipCities, goshipDistricts, goshipWards } from '@/lib/goship';
import { shipmentCarriers } from '@/lib/shipment-carriers';
import { parseParcelOverrides } from '@/lib/parcel';

type PreparationOrder = {
  id: string;
  seller_id: string;
  status: string;
  goship_code: string | null;
  to_goship: { city: string; district: string; ward: string } | null;
  to_name: string | null;
  to_phone: string | null;
  to_address_detail: string | null;
  shipping_fee: number;
  metadata: { shipping_carrier?: string } | null;
  shipping_carrier: string | null;
  parcel_preset: string | null;
  shipping_quote: { listing_override?: boolean } | null;
  card: { product_kind: string | null } | null;
};

type SellerPreparation = {
  goship_pickup: Record<string, string> | null;
  shipping_carriers: string[] | null;
  carrier_coverage: { carriers?: string[] } | null;
  parcel_overrides: unknown;
};

async function handle(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: 'unauthorized' }, { status: 401 });
  const orderId = request.nextUrl.searchParams.get('orderId');
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ code: 'invalid_order' }, { status: 400 });
  const { data: order, error } = await supabase.from('orders')
    .select('id,seller_id,status,goship_code,to_goship,to_name,to_phone,to_address_detail,shipping_fee,metadata,shipping_carrier,parcel_preset,shipping_quote,card:cards(product_kind)')
    .eq('id', orderId).eq('seller_id', user.id).maybeSingle();
  const row = order as PreparationOrder | null;
  if (error) return NextResponse.json({ code: 'preparation_failed' }, { status: 503 });
  if (!row) return NextResponse.json({ code: 'order_not_found' }, { status: 404 });
  if (request.method === 'PUT') {
    if (row.status !== 'paid' || row.goship_code || row.to_goship) return NextResponse.json({ code: 'destination_conflict' }, { status: 409 });
    const body = await request.json().catch(() => null);
    const region = { city: String(body?.city ?? ''), district: String(body?.district ?? ''), ward: String(body?.ward ?? '') };
    if (!Object.values(region).every(v => /^\d{1,12}$/.test(v))) return NextResponse.json({ code: 'invalid_destination' }, { status: 400 });
    const [cities, districts, wards] = await Promise.all([goshipCities(), goshipDistricts(region.city), goshipWards(region.district)]);
    if (!cities.ok || !districts.ok || !wards.ok) return NextResponse.json({ code: 'address_list_failed' }, { status: 503 });
    if (!cities.data.some(v => String(v.id) === region.city) || !districts.data.some(v => String(v.id) === region.district) || !wards.data.some(v => String(v.id) === region.ward)) return NextResponse.json({ code: 'invalid_destination' }, { status: 400 });
    const { data, error: writeError } = await createServiceSupabaseClient().from('orders').update({ to_goship: region } as never)
      .eq('id', orderId).eq('seller_id', user.id).eq('status', 'paid').is('goship_code', null).is('to_goship', null).select('id').maybeSingle();
    if (writeError) return NextResponse.json({ code: 'destination_save_failed' }, { status: 503 });
    if (!data) return NextResponse.json({ code: 'destination_conflict' }, { status: 409 });
    return NextResponse.json({ data: region });
  }
  const { data: seller, error: profileError } = await supabase.from('profiles').select('goship_pickup,shipping_carriers,carrier_coverage,parcel_overrides').eq('id', user.id).single();
  if (profileError) return NextResponse.json({ code: 'preparation_failed' }, { status: 503 });
  const profile = seller as SellerPreparation;
  return NextResponse.json({ data: { order: row, pickup: profile.goship_pickup, carriers: shipmentCarriers(profile.shipping_carriers, profile.carrier_coverage), parcelOverrides: parseParcelOverrides(profile.parcel_overrides) } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export const GET = accountRoute(handle);
export const PUT = accountRoute(handle);
