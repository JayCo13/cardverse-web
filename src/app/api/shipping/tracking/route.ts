import { NextRequest, NextResponse } from 'next/server';
import { getOrderInfo, getGHNStatusInfo } from '@/lib/ghn';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const orderCode = searchParams.get('order_code');

        if (!orderCode) {
            return NextResponse.json({ error: 'order_code is required' }, { status: 400 });
        }

        const info = await getOrderInfo(orderCode);
        const statusInfo = getGHNStatusInfo(info.status);

        return NextResponse.json({
            order_code: info.order_code,
            status: info.status,
            status_label: statusInfo.label,
            status_color: statusInfo.color,
            status_step: statusInfo.step,
            to_name: info.to_name,
            to_address: info.to_address,
            expected_delivery: info.leadtime,
            updated_at: info.updated_date,
            log: info.log,
        });
    } catch (error: any) {
        console.error('Tracking error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
