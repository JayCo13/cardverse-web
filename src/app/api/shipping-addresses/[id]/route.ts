import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { GOSHIP_REGION_ERROR, parseGoshipRegion, resolveGoshipRegion } from '@/lib/goship-region';

type AddressBody = {
    recipient_name?: string;
    phone?: string;
    /**
     * GoShip's city/district/ward ids, from /api/shipping/address/*. The only
     * geography an address is collected in now; the province/ward columns are
     * copied from GoShip's names on save. See ../route.ts.
     */
    goship?: { city?: string; district?: string; ward?: string } | null;
    detail?: string;
    is_default?: boolean;
};

// PATCH — update an address, and/or make it the default. RLS already scopes
// rows to the owner; the explicit user_id filter is belt-and-suspenders.
async function handlePATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as AddressBody;
    const movesAddress = body.goship !== undefined || body.detail !== undefined;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.recipient_name !== undefined) {
        if (!body.recipient_name.trim()) return NextResponse.json({ error: 'Tên người nhận là bắt buộc' }, { status: 400 });
        updates.recipient_name = body.recipient_name.trim();
    }
    if (body.phone !== undefined) {
        if (!body.phone.trim()) return NextResponse.json({ error: 'Số điện thoại là bắt buộc' }, { status: 400 });
        updates.phone = body.phone.trim();
    }

    if (movesAddress) {
        // Region and street are replaced together: a street belongs to the
        // ward it was typed under, so a PATCH that moves one must carry both.
        const region = parseGoshipRegion(body.goship);
        if (!region) return NextResponse.json({ error: 'Vui lòng chọn đầy đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã' }, { status: 400 });
        if (!body.detail?.trim()) return NextResponse.json({ error: 'Vui lòng nhập địa chỉ chi tiết' }, { status: 400 });

        const resolved = await resolveGoshipRegion(region);
        if (!resolved.ok) {
            return NextResponse.json(
                { error: GOSHIP_REGION_ERROR[resolved.reason] },
                { status: resolved.reason === 'unavailable' ? 503 : 400 },
            );
        }
        updates.province_id = Number(resolved.value.city);
        updates.province_name = resolved.value.cityName;
        updates.district_id = Number(resolved.value.district);
        updates.district_name = resolved.value.districtName;
        updates.ward_code = resolved.value.ward;
        updates.ward_name = resolved.value.wardName;
        updates.detail = body.detail.trim();
        updates.goship = region;
    } else if (body.is_default === true) {
        // Promoting a row saved before addresses moved to GoShip's geography
        // would make the default one that no waybill can be booked against.
        // Ask for it to be re-picked instead; the form does that on edit.
        const { data: stored, error: storedError } = await supabase
            .from('shipping_addresses')
            .select('goship')
            .eq('id', id)
            .eq('user_id', user.id)
            .maybeSingle<{ goship: unknown }>();
        if (storedError) {
            return NextResponse.json({ error: storedError.message }, { status: 500 });
        }
        if (!stored) {
            return NextResponse.json({ error: 'Không tìm thấy địa chỉ' }, { status: 404 });
        }
        if (!parseGoshipRegion(stored.goship)) {
            return NextResponse.json(
                { error: 'Địa chỉ này cần chọn lại Tỉnh/Thành, Quận/Huyện, Phường/Xã trước khi đặt làm mặc định.', code: 'address_needs_region' },
                { status: 400 },
            );
        }
    }

    // If this address is being promoted to default, demote the current one.
    if (body.is_default === true) {
        await supabase
            .from('shipping_addresses')
            .update({ is_default: false } as never)
            .eq('user_id', user.id)
            .eq('is_default', true)
            .neq('id', id);
    }
    if (body.is_default !== undefined) updates.is_default = body.is_default;

    const { data, error } = await supabase
        .from('shipping_addresses')
        .update(updates as never)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: 'Không tìm thấy địa chỉ' }, { status: 404 });
    }

    return NextResponse.json({ address: data });
}

// DELETE — remove an address. If it was the default, promote the most recent
// remaining address so the buyer always has a default to fall back on.
async function handleDELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: deleted, error } = await supabase
        .from('shipping_addresses')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
        .select('is_default')
        .single<{ is_default: boolean }>();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (deleted?.is_default) {
        const { data: next } = await supabase
            .from('shipping_addresses')
            .select('id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<{ id: string }>();

        if (next?.id) {
            await supabase
                .from('shipping_addresses')
                .update({ is_default: true } as never)
                .eq('id', next.id)
                .eq('user_id', user.id);
        }
    }

    return NextResponse.json({ success: true });
}

export const PATCH = accountRoute(handlePATCH);
export const DELETE = accountRoute(handleDELETE);
