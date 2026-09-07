import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { findProvince, findWard } from '@/lib/vn-address';

type AddressBody = {
    recipient_name?: string;
    phone?: string;
    province_id?: number;
    province_name?: string;
    /** @deprecated No district level since 1/7/2025. Null on anything saved now. */
    district_id?: number | null;
    /** @deprecated See `district_id`. */
    district_name?: string | null;
    ward_code?: string;
    ward_name?: string;
    detail?: string;
    is_default?: boolean;
};

// PATCH — update an address, and/or make it the default. RLS already scopes
// rows to the owner; the explicit user_id filter is belt-and-suspenders.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as AddressBody;
    const changesAddress = [
        body.province_id,
        body.province_name,
        body.district_id,
        body.district_name,
        body.ward_code,
        body.ward_name,
        body.detail,
    ].some(value => value !== undefined);
    let provinceId = body.province_id;
    let wardCode = body.ward_code;
    let detail = body.detail;

    // Promoting an existing row used to validate only values supplied in this
    // PATCH. A legacy row promoted with `{ is_default: true }` therefore
    // bypassed the current dataset and was copied into the seller profile by
    // the synchronization trigger. Read the owned row first and validate the
    // exact address that will become the default.
    if (!changesAddress && body.is_default === true) {
        const { data: stored, error: storedError } = await supabase
            .from('shipping_addresses')
            .select('province_id, ward_code, detail')
            .eq('id', id)
            .eq('user_id', user.id)
            .maybeSingle<{ province_id: number; ward_code: string; detail: string }>();

        if (storedError) {
            return NextResponse.json({ error: storedError.message }, { status: 500 });
        }
        if (!stored) {
            return NextResponse.json({ error: 'Không tìm thấy địa chỉ' }, { status: 404 });
        }
        provinceId = stored.province_id;
        wardCode = stored.ward_code;
        detail = stored.detail;
    }

    const validatesAddress = changesAddress || body.is_default === true;
    const province = validatesAddress ? findProvince(provinceId) : null;
    const ward = validatesAddress ? findWard(provinceId, wardCode) : null;
    if (validatesAddress && (!province || !ward || !detail?.trim())) {
        return NextResponse.json(
            { error: 'Địa chỉ dùng mã hành chính cũ hoặc Phường/Xã không thuộc Tỉnh/Thành đã chọn' },
            { status: 400 },
        );
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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.recipient_name !== undefined) updates.recipient_name = body.recipient_name.trim();
    if (body.phone !== undefined) updates.phone = body.phone.trim();
    if (validatesAddress && province && ward) {
        updates.province_id = province.code;
        updates.province_name = province.name;
        updates.district_id = null;
        updates.district_name = null;
        updates.ward_code = ward.code.toString();
        updates.ward_name = ward.name;
        updates.detail = detail!.trim();
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
export async function DELETE(
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
