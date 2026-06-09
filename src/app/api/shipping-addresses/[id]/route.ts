import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type AddressBody = {
    recipient_name?: string;
    phone?: string;
    province_id?: number;
    province_name?: string;
    district_id?: number;
    district_name?: string;
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
    if (body.province_id !== undefined) updates.province_id = body.province_id;
    if (body.province_name !== undefined) updates.province_name = body.province_name;
    if (body.district_id !== undefined) updates.district_id = body.district_id;
    if (body.district_name !== undefined) updates.district_name = body.district_name;
    if (body.ward_code !== undefined) updates.ward_code = body.ward_code;
    if (body.ward_name !== undefined) updates.ward_name = body.ward_name;
    if (body.detail !== undefined) updates.detail = body.detail.trim();
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
