import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { refreshCarrierCoverage } from '@/lib/carrier-coverage';

/**
 * Re-probe which couriers collect at this shop's pickup address.
 *
 * POST only: a GET of /api/shipping/shop-shipping already refreshes stale
 * coverage on the way out. This is the "check again" button for a seller who
 * has just heard that a carrier opened in their town.
 */
export async function POST() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data } = await supabase.from('profiles').select('goship_pickup').eq('id', user.id).maybeSingle();
    const pickup = (data as { goship_pickup: { city?: string; district?: string } | null } | null)?.goship_pickup;
    if (!pickup?.city || !pickup?.district) {
        return NextResponse.json({ error: 'Bạn cần lưu địa chỉ lấy hàng trước.', code: 'missing_goship_pickup' }, { status: 409 });
    }

    const coverage = await refreshCarrierCoverage(user.id, { city: pickup.city, district: pickup.district });
    if (!coverage) return NextResponse.json({ error: 'Không hỏi được đơn vị vận chuyển. Thử lại sau.', code: 'shipping_quote_failed' }, { status: 503 });
    return NextResponse.json({ data: { carriers: coverage.carriers, checked_at: coverage.checked_at } });
}
