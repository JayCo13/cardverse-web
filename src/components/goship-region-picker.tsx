'use client';

import { useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

/**
 * Tỉnh → Quận → Phường, in the carrier's geography.
 *
 * GoShip routes on the pre-2025 structure: 63 provinces with districts under
 * them, where the country now has 34 and no district tier at all. The two are
 * never translated — Ho Chi Minh City today contains wards named Bà Rịa and
 * Vũng Tàu that GoShip still files under a province of their own, so matching
 * by name sends a courier to the wrong city and reports success.
 *
 * Just the three levels. Whatever collects a name, a phone or a street already
 * has them; this only supplies what the app's own address cannot express.
 */

export type GoshipRegion = { city: string; district: string; ward: string };

type Option = { code: string; name: string };

const COPY = {
    'vi-VN': {
        city: 'Tỉnh/Thành', district: 'Quận/Huyện', ward: 'Phường/Xã',
        selectCity: 'Chọn Tỉnh/Thành', selectDistrict: 'Chọn Quận/Huyện', selectWard: 'Chọn Phường/Xã',
        loading: 'Đang tải...', error: 'Không tải được danh sách.',
    },
    'en-US': {
        city: 'Province/City', district: 'District', ward: 'Ward',
        selectCity: 'Select province/city', selectDistrict: 'Select district', selectWard: 'Select ward',
        loading: 'Loading...', error: 'Could not load the list.',
    },
    'ja-JP': {
        city: '省/市', district: '郡/区', ward: '坊/社',
        selectCity: '省/市を選択', selectDistrict: '郡/区を選択', selectWard: '坊/社を選択',
        loading: '読み込み中...', error: 'リストを取得できませんでした。',
    },
} as const;

const fetchOptions = async (url: string): Promise<Option[]> => {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
};

export function GoshipRegionPicker({
    value,
    onChange,
    idPrefix = 'goship',
}: {
    value?: Partial<GoshipRegion> | null;
    /** Null until all three are chosen: two of three is not an address. */
    onChange: (region: GoshipRegion | null) => void;
    idPrefix?: string;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [cities, setCities] = useState<Option[]>([]);
    const [districts, setDistricts] = useState<Option[]>([]);
    const [wards, setWards] = useState<Option[]>([]);
    const [busy, setBusy] = useState<'city' | 'district' | 'ward' | null>('city');
    const [failed, setFailed] = useState(false);

    const [city, setCity] = useState(value?.city ?? '');
    const [district, setDistrict] = useState(value?.district ?? '');
    const [ward, setWard] = useState(value?.ward ?? '');

    // onChange is usually an inline arrow; depending on it would re-emit on
    // every render of whatever owns this.
    const emit = useRef(onChange);
    useEffect(() => {
        emit.current = onChange;
    }, [onChange]);

    useEffect(() => {
        let off = false;
        setBusy('city');
        fetchOptions('/api/shipping/address/cities')
            .then((r) => { if (!off) { setCities(r); setFailed(false); } })
            .catch(() => { if (!off) setFailed(true); })
            .finally(() => { if (!off) setBusy(null); });
        return () => { off = true; };
    }, []);

    // Each level clears the ones under it: a ward id means nothing outside the
    // district it came from.
    useEffect(() => {
        if (!city) { setDistricts([]); return; }
        let off = false;
        setBusy('district');
        fetchOptions(`/api/shipping/address/districts?city_code=${encodeURIComponent(city)}`)
            .then((r) => { if (!off) { setDistricts(r); setFailed(false); } })
            .catch(() => { if (!off) setFailed(true); })
            .finally(() => { if (!off) setBusy(null); });
        return () => { off = true; };
    }, [city]);

    useEffect(() => {
        if (!district) { setWards([]); return; }
        let off = false;
        setBusy('ward');
        fetchOptions(`/api/shipping/address/wards?district_code=${encodeURIComponent(district)}`)
            .then((r) => { if (!off) { setWards(r); setFailed(false); } })
            .catch(() => { if (!off) setFailed(true); })
            .finally(() => { if (!off) setBusy(null); });
        return () => { off = true; };
    }, [district]);

    useEffect(() => {
        emit.current(city && district && ward ? { city, district, ward } : null);
    }, [city, district, ward]);

    const level = (
        key: string, label: string, placeholder: string, options: Option[],
        current: string, loading: boolean, disabled: boolean, pick: (v: string) => void,
    ) => (
        <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
            <Select value={current || undefined} onValueChange={pick} disabled={disabled || loading}>
                <SelectTrigger id={`${idPrefix}-${key}`}>
                    {loading
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
        <div className="space-y-3">
            {failed && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />{copy.error}
                </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
                {level('city', copy.city, copy.selectCity, cities, city, busy === 'city', false,
                    (v) => { setCity(v); setDistrict(''); setWard(''); })}
                {level('district', copy.district, copy.selectDistrict, districts, district, busy === 'district', !city,
                    (v) => { setDistrict(v); setWard(''); })}
                {level('ward', copy.ward, copy.selectWard, wards, ward, busy === 'ward', !district,
                    (v) => setWard(v))}
            </div>
        </div>
    );
}
