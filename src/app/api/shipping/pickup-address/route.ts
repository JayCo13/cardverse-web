import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { quoteSellerTiers } from '@/lib/goship-tiers';
import { SHIPPING_CARRIERS } from '@/lib/shipping-carriers';

/**
 * The seller's pickup address, in GoShip's geography.
 *
 * Separate from /api/shipping-addresses, which stores where a buyer receives
 * things in the 2025 structure — 34 provinces, no districts. This one holds
 * GoShip's pre-2025 ids and exists only to dispatch a courier. The two are
 * never joined: Ho Chi Minh City now contains wards named Bà Rịa and Vũng Tàu
 * that GoShip still files under a province of their own, so a name match books
 * a pickup in the wrong city and reports success.
 *
 * Values must come from /api/shipping/address/*, which proxies GoShip's own
 * lists. The database has a CHECK on the shape, but shape is all it can see: an
 * id from the app's own tables is digits too, so it is the source that makes
 * this correct, not the constraint.
 */

type Pickup = {
    city: string;
    district: string;
    ward: string;
    street: string;
    name: string;
    phone: string;
};

const ID = /^[0-9]{1,12}$/;
/** Vietnamese mobile numbers, the only kind a carrier will call. */
const PHONE = /^0[0-9]{8,10}$/;

function parse(body: unknown): { ok: true; value: Pickup } | { ok: false; error: string } {
    if (!body || typeof body !== 'object') return { ok: false, error: 'Thiếu dữ liệu địa chỉ.' };
    const b = body as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');

    const value: Pickup = {
        city: str('city'),
        district: str('district'),
        ward: str('ward'),
        street: str('street'),
        name: str('name'),
        phone: str('phone').replace(/\s+/g, ''),
    };

    if (!ID.test(value.city)) return { ok: false, error: 'Chưa chọn tỉnh/thành.' };
    if (!ID.test(value.district)) return { ok: false, error: 'Chưa chọn quận/huyện.' };
    if (!ID.test(value.ward)) return { ok: false, error: 'Chưa chọn phường/xã.' };
    if (value.street.length < 1 || value.street.length > 255) {
        return { ok: false, error: 'Địa chỉ cụ thể cần 1-255 ký tự.' };
    }
    if (value.name.length < 1 || value.name.length > 120) {
        return { ok: false, error: 'Tên người gửi cần 1-120 ký tự.' };
    }
    if (!PHONE.test(value.phone)) {
        return { ok: false, error: 'Số điện thoại không hợp lệ (bắt đầu bằng 0, 9-11 chữ số).' };
    }
    return { ok: true, value };
}

export async function GET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('profiles')
        .select('goship_pickup')
        .eq('id', user.id)
        .single();
    if (error) return NextResponse.json({ error: 'Không đọc được địa chỉ lấy hàng.' }, { status: 500 });

    return NextResponse.json({ data: (data as { goship_pickup: Pickup | null }).goship_pickup });
}

export async function PUT(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = parse(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Own row only — RLS decides, and the id is never taken from the body.
    const { error } = await supabase
        .from('profiles')
        .update({ goship_pickup: parsed.value } as never)
        .eq('id', user.id);

    if (error) {
        console.error('[Pickup] Save failed:', error.message);
        return NextResponse.json({ error: 'Không lưu được địa chỉ lấy hàng.' }, { status: 500 });
    }

    // Reprice the shop from the new address.
    //
    // Here rather than on a schedule, because this is the only moment the
    // answer changes: a listing's fee range is measured from where the parcel
    // leaves, and that is what just moved. Three upstream calls, awaited so a
    // seller who saves and looks at their listings sees the new numbers.
    //
    // Best-effort. A pricing refresh that fails must not undo an address that
    // saved: the fees fall back to whatever the seller typed, which is what
    // they were before.
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('address_province_name')
            .eq('id', user.id)
            .single();

        const fees = await quoteSellerTiers({
            pickup: { city: parsed.value.city, district: parsed.value.district },
            provinceName: (profile as { address_province_name: string | null } | null)?.address_province_name,
            allowedCarriers: SHIPPING_CARRIERS.map((c) => c.code).filter((c) => c !== 'self'),
        });

        if (Object.keys(fees).length > 0) {
            const service = createServiceSupabaseClient();
            await service
                .from('profiles')
                .update({ goship_tier_fees: fees, goship_tier_fees_at: new Date().toISOString() } as never)
                .eq('id', user.id);
        }
    } catch (repriceError) {
        console.error('[Pickup] Could not reprice tiers:', repriceError);
    }

    return NextResponse.json({ data: parsed.value });
}
