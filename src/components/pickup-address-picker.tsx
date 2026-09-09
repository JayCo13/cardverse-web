'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

/**
 * The sender block on a waybill, picked in the carrier's own geography.
 *
 * Not a pickup request. Most Vietnamese sellers drop parcels at a branch rather
 * than wait for a courier, so this is what gets printed on the label and where
 * a failed delivery returns to — which the carrier needs either way.
 *
 * Deliberately not AddressPicker. That one serves the structure Vietnam
 * actually has since Nghị quyết 202/2025/QH15 — 34 provinces, no districts —
 * and marks its district fields deprecated. GoShip still routes on the pre-2025
 * one, so this has three levels, and the two are never mixed: Ho Chi Minh City
 * now contains wards named Bà Rịa and Vũng Tàu that GoShip still files under a
 * province of their own, so translating between them sends a driver to the
 * wrong city and reports success.
 *
 * Every option here comes from GoShip's own lists, which is what makes the ids
 * correct — the database CHECK only sees their shape.
 */

export type PickupAddress = {
    city: string;
    district: string;
    ward: string;
    street: string;
    name: string;
    phone: string;
};

type Option = { code: string; name: string };

const COPY = {
    'vi-VN': {
        city: 'Tỉnh/Thành', district: 'Quận/Huyện', ward: 'Phường/Xã',
        selectCity: 'Chọn Tỉnh/Thành', selectDistrict: 'Chọn Quận/Huyện', selectWard: 'Chọn Phường/Xã',
        street: 'Địa chỉ cụ thể', streetPlaceholder: 'Số nhà, tên đường...',
        name: 'Tên người gửi', phone: 'Số điện thoại',
        loading: 'Đang tải...', loadError: 'Không tải được danh sách. Thử lại sau.',
        note: 'Danh mục địa giới do đơn vị vận chuyển cung cấp nên có thể khác địa chỉ trong hồ sơ của bạn. Chọn theo địa chỉ bạn muốn in trên vận đơn — bạn vẫn có thể mang hàng ra bưu cục gửi.',
        phoneHint: 'Bắt đầu bằng 0, 9-11 chữ số.',
    },
    'en-US': {
        city: 'Province/City', district: 'District', ward: 'Ward',
        selectCity: 'Select province/city', selectDistrict: 'Select district', selectWard: 'Select ward',
        street: 'Street address', streetPlaceholder: 'House number, street...',
        name: 'Sender name', phone: 'Phone number',
        loading: 'Loading...', loadError: 'Could not load the list. Try again later.',
        note: 'These divisions come from the carrier, so they may differ from the address on your profile. Pick the address to print on the waybill — you can still drop the parcel off at a branch.',
        phoneHint: 'Starts with 0, 9-11 digits.',
    },
    'ja-JP': {
        city: '省/市', district: '郡/区', ward: '坊/社',
        selectCity: '省/市を選択', selectDistrict: '郡/区を選択', selectWard: '坊/社を選択',
        street: '詳細住所', streetPlaceholder: '番地、通り名...',
        name: '差出人名', phone: '電話番号',
        loading: '読み込み中...', loadError: 'リストを取得できませんでした。',
        note: 'この行政区分は配送業者のもので、プロフィールの住所と異なる場合があります。送り状に印字する住所を選んでください。窓口へ持ち込むこともできます。',
        phoneHint: '0で始まる9〜11桁。',
    },
} as const;

async function fetchOptions(url: string): Promise<Option[]> {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data : [];
}

export function PickupAddressPicker({
    value,
    onChange,
}: {
    value?: Partial<PickupAddress> | null;
    /** Null until every field is valid, so a caller cannot save a half address. */
    onChange: (address: PickupAddress | null) => void;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [cities, setCities] = useState<Option[]>([]);
    const [districts, setDistricts] = useState<Option[]>([]);
    const [wards, setWards] = useState<Option[]>([]);
    const [loading, setLoading] = useState<'city' | 'district' | 'ward' | null>('city');
    const [error, setError] = useState(false);

    const [form, setForm] = useState<PickupAddress>({
        city: value?.city ?? '', district: value?.district ?? '', ward: value?.ward ?? '',
        street: value?.street ?? '', name: value?.name ?? '', phone: value?.phone ?? '',
    });

    // onChange is usually an inline arrow, so depending on it would re-run the
    // emit effect on every parent render.
    const emit = useRef(onChange);
    useEffect(() => {
        emit.current = onChange;
    }, [onChange]);

    useEffect(() => {
        let cancelled = false;
        setLoading('city');
        fetchOptions('/api/shipping/address/cities')
            .then((rows) => { if (!cancelled) { setCities(rows); setError(false); } })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(null); });
        return () => { cancelled = true; };
    }, []);

    // Districts follow the city, wards follow the district. Each level clears
    // what sits under it, because a ward id is only meaningful inside the
    // district it came from.
    useEffect(() => {
        if (!form.city) { setDistricts([]); return; }
        let cancelled = false;
        setLoading('district');
        fetchOptions(`/api/shipping/address/districts?city_code=${encodeURIComponent(form.city)}`)
            .then((rows) => { if (!cancelled) { setDistricts(rows); setError(false); } })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(null); });
        return () => { cancelled = true; };
    }, [form.city]);

    useEffect(() => {
        if (!form.district) { setWards([]); return; }
        let cancelled = false;
        setLoading('ward');
        fetchOptions(`/api/shipping/address/wards?district_code=${encodeURIComponent(form.district)}`)
            .then((rows) => { if (!cancelled) { setWards(rows); setError(false); } })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(null); });
        return () => { cancelled = true; };
    }, [form.district]);

    useEffect(() => {
        const phone = form.phone.replace(/\s+/g, '');
        const complete = /^[0-9]{1,12}$/.test(form.city)
            && /^[0-9]{1,12}$/.test(form.district)
            && /^[0-9]{1,12}$/.test(form.ward)
            && form.street.trim().length > 0 && form.street.trim().length <= 255
            && form.name.trim().length > 0 && form.name.trim().length <= 120
            && /^0[0-9]{8,10}$/.test(phone);
        emit.current(complete
            ? { ...form, street: form.street.trim(), name: form.name.trim(), phone }
            : null);
    }, [form]);

    const set = useCallback((patch: Partial<PickupAddress>) => {
        setForm((prev) => ({ ...prev, ...patch }));
    }, []);

    const level = (
        id: string, label: string, placeholder: string,
        options: Option[], current: string, busy: boolean,
        disabled: boolean, onPick: (code: string) => void,
    ) => (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Select value={current || undefined} onValueChange={onPick} disabled={disabled || busy}>
                <SelectTrigger id={id}>
                    {busy
                        ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{copy.loading}</span>
                        : <SelectValue placeholder={placeholder} />}
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => <SelectItem key={o.code} value={o.code}>{o.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <div className="space-y-4">
            <p className="text-xs leading-5 text-muted-foreground">{copy.note}</p>

            {error && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />{copy.loadError}
                </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                {level('pickup-city', copy.city, copy.selectCity, cities, form.city,
                    loading === 'city', false,
                    (code) => set({ city: code, district: '', ward: '' }))}
                {level('pickup-district', copy.district, copy.selectDistrict, districts, form.district,
                    loading === 'district', !form.city,
                    (code) => set({ district: code, ward: '' }))}
                {level('pickup-ward', copy.ward, copy.selectWard, wards, form.ward,
                    loading === 'ward', !form.district,
                    (code) => set({ ward: code }))}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="pickup-street">{copy.street}</Label>
                <Input id="pickup-street" value={form.street} maxLength={255}
                    placeholder={copy.streetPlaceholder}
                    onChange={(e) => set({ street: e.target.value })} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="pickup-name">{copy.name}</Label>
                    <Input id="pickup-name" value={form.name} maxLength={120}
                        onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="pickup-phone">{copy.phone}</Label>
                    <Input id="pickup-phone" value={form.phone} inputMode="tel" maxLength={15}
                        onChange={(e) => set({ phone: e.target.value })} />
                    <p className="text-xs text-muted-foreground">{copy.phoneHint}</p>
                </div>
            </div>
        </div>
    );
}
