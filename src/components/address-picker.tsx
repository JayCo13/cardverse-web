'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

type Province = { ProvinceID: number; ProvinceName: string };
type District = { DistrictID: number; DistrictName: string; ProvinceID: number };
type Ward = { WardCode: string; WardName: string; DistrictID: number };

export type AddressData = {
    provinceId: number;
    provinceName: string;
    districtId: number;
    districtName: string;
    wardCode: string;
    wardName: string;
    detail: string;
};

type AddressPickerProps = {
    value?: Partial<AddressData>;
    onChange: (address: AddressData | null) => void;
    showDetail?: boolean;
    detailPlaceholder?: string;
    compact?: boolean;
    label?: string;
};

export function AddressPicker({
    value,
    onChange,
    showDetail = true,
    detailPlaceholder,
    compact = false,
    label,
}: AddressPickerProps) {
    const { locale } = useLocalization();
    const copy = locale === 'vi-VN'
        ? {
            detailPlaceholder: 'Số nhà, đường...',
            province: 'Tỉnh/Thành',
            district: 'Quận/Huyện',
            ward: 'Phường/Xã',
            loading: 'Đang tải...',
            selectProvince: 'Chọn Tỉnh/Thành',
            selectDistrict: 'Chọn Quận/Huyện',
            selectWard: 'Chọn Phường/Xã',
            loadError: 'Không thể tải dữ liệu địa chỉ.',
            retry: 'Thử lại',
        }
        : locale === 'ja-JP'
            ? {
                detailPlaceholder: '番地・通り名...',
                province: '都道府県',
                district: '区・郡',
                ward: '区・町・村',
                loading: '読み込み中...',
                selectProvince: '都道府県を選択',
                selectDistrict: '区・郡を選択',
                selectWard: '区・町・村を選択',
                loadError: '住所データを読み込めませんでした。',
                retry: '再試行',
            }
            : {
                detailPlaceholder: 'House number, street...',
                province: 'Province/City',
                district: 'District',
                ward: 'Ward',
                loading: 'Loading...',
                selectProvince: 'Select province/city',
                selectDistrict: 'Select district',
                selectWard: 'Select ward',
                loadError: 'Unable to load address data.',
                retry: 'Retry',
            };
    const [provinces, setProvinces] = useState<Province[]>([]);
    const [districts, setDistricts] = useState<District[]>([]);
    const [wards, setWards] = useState<Ward[]>([]);

    const [selectedProvince, setSelectedProvince] = useState<string>(value?.provinceId?.toString() || '');
    const [selectedDistrict, setSelectedDistrict] = useState<string>(value?.districtId?.toString() || '');
    const [selectedWard, setSelectedWard] = useState<string>(value?.wardCode || '');
    const [detail, setDetail] = useState(value?.detail || '');

    const [loadingProvinces, setLoadingProvinces] = useState(false);
    const [loadingDistricts, setLoadingDistricts] = useState(false);
    const [loadingWards, setLoadingWards] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [retryNonce, setRetryNonce] = useState(0);
    const onChangeRef = useRef(onChange);
    const lastEmittedRef = useRef<string | null>(null);

    /**
     * The address this picker was mounted with, kept for the whole life of the
     * instance. GHN's master-data lists are slow, and go down outright when the
     * token lapses; Radix resolves a Select's label from its items, so with an
     * empty list an edit form shows three empty selects, `emitChange` resolves
     * nothing, reports `null` upward, and the parent clears the very row the
     * user opened. Seeding the lists from what was already saved keeps the form
     * readable and truthful whether or not GHN answers.
     *
     * Callers give the picker a `key` per address, so a remount is what changes
     * this — not a re-render.
     */
    const initialRef = useRef<Partial<AddressData> | undefined>(value);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        // Only an address arriving from outside is applied. The parent also
        // goes null while the user re-picks a province — that is this picker's
        // own doing, and echoing it back would wipe the selection mid-edit.
        if (!value?.provinceId) return;
        setSelectedProvince(value.provinceId.toString());
        setSelectedDistrict(value.districtId?.toString() || '');
        setSelectedWard(value.wardCode || '');
        setDetail(value.detail || '');
    }, [value?.provinceId, value?.districtId, value?.wardCode, value?.detail]);

    // Load provinces on mount
    useEffect(() => {
        const fetchProvinces = async () => {
            setLoadingProvinces(true);
            setLoadError('');
            try {
                const res = await fetch('/api/shipping/provinces');
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || copy.loadError);
                setProvinces(data.data || []);
            } catch (err) {
                // The carrier's own wording ("Token is not valid!") means
                // nothing to a buyer and names our integration; log it, show
                // them the sentence they can act on.
                console.error('Failed to fetch provinces:', err);
                setLoadError(copy.loadError);
            } finally {
                setLoadingProvinces(false);
            }
        };
        fetchProvinces();
    }, [retryNonce]);

    // Load districts when province changes
    useEffect(() => {
        if (!selectedProvince) {
            setDistricts([]);
            return;
        }
        const fetchDistricts = async () => {
            setLoadingDistricts(true);
            setLoadError('');
            try {
                const res = await fetch(`/api/shipping/districts?province_id=${selectedProvince}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || copy.loadError);
                setDistricts(data.data || []);
            } catch (err) {
                console.error('Failed to fetch districts:', err);
                setLoadError(copy.loadError);
            } finally {
                setLoadingDistricts(false);
            }
        };
        fetchDistricts();
    }, [selectedProvince, retryNonce]);

    // Load wards when district changes
    useEffect(() => {
        if (!selectedDistrict) {
            setWards([]);
            return;
        }
        const fetchWards = async () => {
            setLoadingWards(true);
            setLoadError('');
            try {
                const res = await fetch(`/api/shipping/wards?district_id=${selectedDistrict}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || copy.loadError);
                setWards(data.data || []);
            } catch (err) {
                console.error('Failed to fetch wards:', err);
                setLoadError(copy.loadError);
            } finally {
                setLoadingWards(false);
            }
        };
        fetchWards();
    }, [selectedDistrict, retryNonce]);

    const provinceOptions = useMemo(() => {
        const saved = initialRef.current;
        const list = provinces.slice();
        if (saved?.provinceId && saved.provinceName && !list.some(p => p.ProvinceID === saved.provinceId)) {
            list.push({ ProvinceID: saved.provinceId, ProvinceName: saved.provinceName });
        }
        return list.sort((a, b) => a.ProvinceName.localeCompare(b.ProvinceName));
    }, [provinces]);

    const districtOptions = useMemo(() => {
        const saved = initialRef.current;
        const list = districts.slice();
        // Only while the saved province is still the selected one — once the
        // user picks a different province the saved district is not an option.
        if (
            saved?.districtId && saved.districtName &&
            saved.provinceId?.toString() === selectedProvince &&
            !list.some(d => d.DistrictID === saved.districtId)
        ) {
            list.push({ DistrictID: saved.districtId, DistrictName: saved.districtName, ProvinceID: saved.provinceId! });
        }
        return list.sort((a, b) => a.DistrictName.localeCompare(b.DistrictName));
    }, [districts, selectedProvince]);

    const wardOptions = useMemo(() => {
        const saved = initialRef.current;
        const list = wards.slice();
        if (
            saved?.wardCode && saved.wardName &&
            saved.districtId?.toString() === selectedDistrict &&
            !list.some(w => w.WardCode === saved.wardCode)
        ) {
            list.push({ WardCode: saved.wardCode, WardName: saved.wardName, DistrictID: saved.districtId! });
        }
        return list.sort((a, b) => a.WardName.localeCompare(b.WardName));
    }, [wards, selectedDistrict]);

    // Emit changes
    const emitChange = useCallback((
        pId: string, dId: string, wCode: string, det: string
    ) => {
        const province = provinceOptions.find(p => p.ProvinceID.toString() === pId);
        const district = districtOptions.find(d => d.DistrictID.toString() === dId);
        const ward = wardOptions.find(w => w.WardCode === wCode);
        const nextKey = province && district && ward
            ? `${province.ProvinceID}|${district.DistrictID}|${ward.WardCode}|${det}`
            : 'null';

        if (lastEmittedRef.current === nextKey) {
            return;
        }
        lastEmittedRef.current = nextKey;

        if (province && district && ward) {
            onChangeRef.current({
                provinceId: province.ProvinceID,
                provinceName: province.ProvinceName,
                districtId: district.DistrictID,
                districtName: district.DistrictName,
                wardCode: ward.WardCode,
                wardName: ward.WardName,
                detail: det,
            });
        } else {
            onChangeRef.current(null);
        }
    }, [provinceOptions, districtOptions, wardOptions]);

    // Trigger emitChange when ward or detail changes
    useEffect(() => {
        if (selectedProvince && selectedDistrict && selectedWard) {
            emitChange(selectedProvince, selectedDistrict, selectedWard, detail);
        }
    }, [selectedWard, detail, emitChange, selectedProvince, selectedDistrict]);

    const handleProvinceChange = (val: string) => {
        setSelectedProvince(val);
        setSelectedDistrict('');
        setSelectedWard('');
        setDistricts([]);
        setWards([]);
        lastEmittedRef.current = null;
        onChangeRef.current(null);
    };

    const handleDistrictChange = (val: string) => {
        setSelectedDistrict(val);
        setSelectedWard('');
        setWards([]);
        lastEmittedRef.current = null;
        onChangeRef.current(null);
    };

    const handleWardChange = (val: string) => {
        setSelectedWard(val);
    };

    const gridCols = compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3';

    return (
        <div className="space-y-3">
            {label && (
                <Label className="text-sm font-medium flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {label}
                </Label>
            )}

            {loadError && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    <span className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {loadError}
                    </span>
                    <button type="button" className="flex shrink-0 items-center gap-1 font-medium hover:text-red-200" onClick={() => setRetryNonce(value => value + 1)}>
                        <RefreshCw className="h-3.5 w-3.5" /> {copy.retry}
                    </button>
                </div>
            )}

            <div className={`grid ${gridCols} gap-2`}>
                {/* Province */}
                <div>
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">{copy.province}</Label>}
                    <Select value={selectedProvince} onValueChange={handleProvinceChange}>
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingProvinces ? copy.loading : copy.selectProvince} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingProvinces && provinceOptions.length === 0 ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                provinceOptions.map(p => (
                                    <SelectItem key={p.ProvinceID} value={p.ProvinceID.toString()}>
                                        {p.ProvinceName}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>

                {/* District */}
                <div>
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">{copy.district}</Label>}
                    <Select
                        value={selectedDistrict}
                        onValueChange={handleDistrictChange}
                        disabled={!selectedProvince}
                    >
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingDistricts ? copy.loading : copy.selectDistrict} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingDistricts && districtOptions.length === 0 ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                districtOptions.map(d => (
                                    <SelectItem key={d.DistrictID} value={d.DistrictID.toString()}>
                                        {d.DistrictName}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>

                {/* Ward */}
                <div>
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">{copy.ward}</Label>}
                    <Select
                        value={selectedWard}
                        onValueChange={handleWardChange}
                        disabled={!selectedDistrict}
                    >
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingWards ? copy.loading : copy.selectWard} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingWards && wardOptions.length === 0 ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                wardOptions.map(w => (
                                    <SelectItem key={w.WardCode} value={w.WardCode}>
                                        {w.WardName}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Detail address */}
            {showDetail && (
                <Input
                    value={detail}
                    onChange={e => setDetail(e.target.value)}
                    placeholder={detailPlaceholder || copy.detailPlaceholder}
                    className="h-9 text-sm"
                />
            )}
        </div>
    );
}
