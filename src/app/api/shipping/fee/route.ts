import { NextRequest, NextResponse } from 'next/server';
import { calculateShippingFee } from '@/lib/ghn';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const fromDistrictId = parseInt(searchParams.get('from_district_id') || '0');
        const fromWardCode = searchParams.get('from_ward_code') || '';
        const toDistrictId = parseInt(searchParams.get('to_district_id') || '0');
        const toWardCode = searchParams.get('to_ward_code') || '';
        const insuranceValue = parseInt(searchParams.get('insurance_value') || '0');

        if (!fromDistrictId || !fromWardCode || !toDistrictId || !toWardCode) {
            return NextResponse.json({
                error: 'from_district_id, from_ward_code, to_district_id, to_ward_code are required'
            }, { status: 400 });
        }

        const fee = await calculateShippingFee({
            fromDistrictId,
            fromWardCode,
            toDistrictId,
            toWardCode,
            insuranceValue,
        });

        return NextResponse.json({
            shipping_fee: fee.total,
            service_fee: fee.service_fee,
            insurance_fee: fee.insurance_fee,
            details: fee,
        });
    } catch (error: any) {
        console.error('Calculate shipping fee error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
