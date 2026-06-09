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

function validate(body: AddressBody): string | null {
    if (!body.recipient_name?.trim()) return 'Tên người nhận là bắt buộc';
    if (!body.phone?.trim()) return 'Số điện thoại là bắt buộc';
    if (!body.province_id || !body.district_id || !body.ward_code) return 'Vui lòng chọn đầy đủ Tỉnh/Quận/Phường';
    if (!body.detail?.trim()) return 'Vui lòng nhập địa chỉ chi tiết';
    return null;
}

// GET — list the current user's saved addresses (default first, then newest).
export async function GET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('shipping_addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ addresses: data ?? [] });
}

// POST — create a new address. The first address (or one flagged is_default)
// becomes the default; setting a new default clears the previous one.
export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as AddressBody;
    const validationError = validate(body);
    if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { count } = await supabase
        .from('shipping_addresses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

    const makeDefault = body.is_default === true || (count ?? 0) === 0;

    if (makeDefault) {
        await supabase
            .from('shipping_addresses')
            .update({ is_default: false } as never)
            .eq('user_id', user.id)
            .eq('is_default', true);
    }

    const { data, error } = await supabase
        .from('shipping_addresses')
        .insert({
            user_id: user.id,
            recipient_name: body.recipient_name!.trim(),
            phone: body.phone!.trim(),
            province_id: body.province_id!,
            province_name: body.province_name ?? '',
            district_id: body.district_id!,
            district_name: body.district_name ?? '',
            ward_code: body.ward_code!,
            ward_name: body.ward_name ?? '',
            detail: body.detail!.trim(),
            is_default: makeDefault,
        } as never)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ address: data }, { status: 201 });
}
