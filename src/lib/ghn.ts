// GHN (Giao Hàng Nhanh) API Client
// Docs: https://api.ghn.vn/home/docs/detail

const GHN_BASE_URL = 'https://online-gateway.ghn.vn/shiip/public-api/v2';
const GHN_TOKEN = process.env.GHN_TOKEN || '';
const GHN_SHOP_ID = process.env.GHN_SHOP_ID || '';

// Default dimensions for trading cards (envelope)
export const CARD_DEFAULTS = {
    weight: 100,     // grams
    length: 20,      // cm
    width: 12,       // cm
    height: 2,       // cm
    service_type_id: 2, // E-Commerce Delivery
};

// ── Types ──

export type GHNProvince = {
    ProvinceID: number;
    ProvinceName: string;
    Code: string;
};

export type GHNDistrict = {
    DistrictID: number;
    ProvinceID: number;
    DistrictName: string;
    Code: string;
    Type: number;
    SupportType: number;
};

export type GHNWard = {
    WardCode: string;
    DistrictID: number;
    WardName: string;
};

export type GHNShippingFee = {
    total: number;
    service_fee: number;
    insurance_fee: number;
    pick_station_fee: number;
    coupon_value: number;
    r2s_fee: number;
    cod_fee: number;
    pick_remote_areas_fee: number;
    deliver_remote_areas_fee: number;
};

export type GHNService = {
    service_id: number;
    short_name: string;
    service_type_id: number;
};

export type GHNOrderStatus =
    | 'ready_to_pick'
    | 'picking'
    | 'cancel'
    | 'money_collect_picking'
    | 'picked'
    | 'storing'
    | 'transporting'
    | 'sorting'
    | 'delivering'
    | 'money_collect_delivering'
    | 'delivered'
    | 'delivery_fail'
    | 'waiting_to_return'
    | 'return'
    | 'return_transporting'
    | 'return_sorting'
    | 'returning'
    | 'return_fail'
    | 'returned'
    | 'exception'
    | 'damage'
    | 'lost';

export type GHNOrderInfo = {
    order_code: string;
    status: GHNOrderStatus;
    to_name: string;
    to_phone: string;
    to_address: string;
    to_ward_name: string;
    to_district_name: string;
    to_province_name?: string;
    leadtime: string; // ISO date
    updated_date: string;
    log: Array<{ status: string; updated_date: string }>;
};

export type CreateOrderParams = {
    to_name: string;
    to_phone: string;
    to_address: string;
    to_ward_code: string;
    to_district_id: number;
    // From address (seller) — if not provided, uses shop default
    from_name?: string;
    from_phone?: string;
    from_address?: string;
    from_ward_name?: string;
    from_district_id?: number;
    // Order details
    cod_amount?: number; // Cash on delivery (0 for prepaid)
    insurance_value?: number; // Declared value for insurance
    note?: string;
    client_order_code?: string; // Our internal order ID
    required_note?: 'CHOTHUHANG' | 'CHOXEMHANGKHONGTHU' | 'KHONGCHOXEMHANG';
};

// ── Internal helper ──

async function ghnFetch<T>(endpoint: string, options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    shopId?: string;
} = {}): Promise<T> {
    const { method = 'POST', body, shopId = GHN_SHOP_ID } = options;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Token': GHN_TOKEN,
    };

    if (shopId) {
        headers['ShopId'] = shopId;
    }

    const res = await fetch(`${GHN_BASE_URL}${endpoint}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json();

    if (data.code !== 200) {
        throw new Error(`GHN API Error [${endpoint}]: ${data.message || JSON.stringify(data)}`);
    }

    return data.data;
}

// ── Address APIs ──

export async function getProvinces(): Promise<GHNProvince[]> {
    return ghnFetch<GHNProvince[]>('/master-data/province');
}

export async function getDistricts(provinceId: number): Promise<GHNDistrict[]> {
    return ghnFetch<GHNDistrict[]>('/master-data/district', {
        body: { province_id: provinceId },
    });
}

export async function getWards(districtId: number): Promise<GHNWard[]> {
    return ghnFetch<GHNWard[]>('/master-data/ward', {
        body: { district_id: districtId },
    });
}

// ── Shipping Fee ──

export async function getAvailableServices(fromDistrictId: number, toDistrictId: number): Promise<GHNService[]> {
    return ghnFetch<GHNService[]>('/shipping-order/available-services', {
        body: {
            shop_id: parseInt(GHN_SHOP_ID),
            from_district: fromDistrictId,
            to_district: toDistrictId,
        },
    });
}

export async function calculateShippingFee(params: {
    fromDistrictId: number;
    fromWardCode: string;
    toDistrictId: number;
    toWardCode: string;
    serviceId?: number;
    insuranceValue?: number;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
}): Promise<GHNShippingFee> {
    const {
        fromDistrictId,
        fromWardCode,
        toDistrictId,
        toWardCode,
        serviceId,
        insuranceValue = 0,
        weight = CARD_DEFAULTS.weight,
        length = CARD_DEFAULTS.length,
        width = CARD_DEFAULTS.width,
        height = CARD_DEFAULTS.height,
    } = params;

    const body: Record<string, unknown> = {
        from_district_id: fromDistrictId,
        from_ward_code: fromWardCode,
        to_district_id: toDistrictId,
        to_ward_code: toWardCode,
        service_type_id: CARD_DEFAULTS.service_type_id,
        weight,
        length,
        width,
        height,
        insurance_value: insuranceValue,
    };

    if (serviceId) {
        body.service_id = serviceId;
    }

    return ghnFetch<GHNShippingFee>('/shipping-order/fee', { body });
}

// ── Order Management ──

export async function createShippingOrder(params: CreateOrderParams): Promise<{
    order_code: string;
    expected_delivery_time: string;
    total_fee: number;
    sort_code: string;
    trans_type: string;
}> {
    return ghnFetch('/shipping-order/create', {
        body: {
            payment_type_id: 1, // 1 = seller pays shipping fee upfront (we already collected from buyer)
            note: params.note || 'Thẻ bài - Xử lý cẩn thận',
            required_note: params.required_note || 'CHOTHUHANG',
            client_order_code: params.client_order_code,
            to_name: params.to_name,
            to_phone: params.to_phone,
            to_address: params.to_address,
            to_ward_code: params.to_ward_code,
            to_district_id: params.to_district_id,
            ...(params.from_name ? { from_name: params.from_name } : {}),
            ...(params.from_phone ? { from_phone: params.from_phone } : {}),
            ...(params.from_address ? { from_address: params.from_address } : {}),
            ...(params.from_ward_name ? { from_ward_name: params.from_ward_name } : {}),
            ...(params.from_district_id ? { from_district_id: params.from_district_id } : {}),
            cod_amount: params.cod_amount || 0,
            insurance_value: params.insurance_value || 0,
            weight: CARD_DEFAULTS.weight,
            length: CARD_DEFAULTS.length,
            width: CARD_DEFAULTS.width,
            height: CARD_DEFAULTS.height,
            service_type_id: CARD_DEFAULTS.service_type_id,
            items: [{
                name: 'Trading Card',
                quantity: 1,
                weight: CARD_DEFAULTS.weight,
                length: CARD_DEFAULTS.length,
                width: CARD_DEFAULTS.width,
                height: CARD_DEFAULTS.height,
            }],
        },
    });
}

export async function getOrderInfo(orderCode: string): Promise<GHNOrderInfo> {
    return ghnFetch<GHNOrderInfo>('/shipping-order/detail', {
        body: { order_code: orderCode },
    });
}

export async function cancelOrder(orderCodes: string[]): Promise<unknown> {
    return ghnFetch('/switch-status/cancel', {
        body: { order_codes: orderCodes },
    });
}

// ── Status helpers ──

export const GHN_STATUS_MAP: Record<string, { label: string; color: string; step: number }> = {
    ready_to_pick: { label: 'Chờ lấy hàng', color: 'text-blue-400', step: 1 },
    picking: { label: 'Đang lấy hàng', color: 'text-blue-400', step: 1 },
    picked: { label: 'Đã lấy hàng', color: 'text-cyan-400', step: 2 },
    storing: { label: 'Đang lưu kho', color: 'text-cyan-400', step: 2 },
    transporting: { label: 'Đang vận chuyển', color: 'text-yellow-400', step: 3 },
    sorting: { label: 'Đang phân loại', color: 'text-yellow-400', step: 3 },
    delivering: { label: 'Đang giao hàng', color: 'text-orange-400', step: 4 },
    delivered: { label: 'Đã giao hàng', color: 'text-green-400', step: 5 },
    delivery_fail: { label: 'Giao thất bại', color: 'text-red-400', step: 4 },
    cancel: { label: 'Đã hủy', color: 'text-gray-400', step: 0 },
    return: { label: 'Đang hoàn', color: 'text-purple-400', step: 0 },
    returning: { label: 'Đang trả hàng', color: 'text-purple-400', step: 0 },
    returned: { label: 'Đã hoàn', color: 'text-purple-400', step: 0 },
    exception: { label: 'Ngoại lệ', color: 'text-red-400', step: 0 },
    damage: { label: 'Hư hỏng', color: 'text-red-400', step: 0 },
    lost: { label: 'Thất lạc', color: 'text-red-400', step: 0 },
};

export function getGHNStatusInfo(status: string) {
    return GHN_STATUS_MAP[status] || { label: status, color: 'text-gray-400', step: 0 };
}
