'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

type Province = { code: number; name: string };
type Ward = { code: number; name: string };

export type AddressData = {
    provinceId: number;
    provinceName: string;
    wardCode: string;
    wardName: string;
    detail: string;
    /**
     * @deprecated There is no district level any more.
     *
     * Vietnam abolished the district tier on 1/7/2025 and merged 63 provinces
     * into 34 (Nghị quyết 202/2025/QH15), so an address is a province and a
     * ward. These two fields remain only so that rows written before that date
     * still typecheck where they are read back for display; nothing produces
     * them now, and anything saving an address should null the columns out.
     */
    districtId?: number;
    /** @deprecated See `districtId`. */
    districtName?: string;
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
            ward: 'Phường/Xã',
            loading: 'Đang tải...',
            selectProvince: 'Chọn Tỉnh/Thành',
            selectWard: 'Chọn Phường/Xã',
            loadError: 'Không thể tải dữ liệu địa chỉ.',
            retry: 'Thử lại',
        }
        : locale === 'ja-JP'
            ? {
                detailPlaceholder: '番地・通り名...',
                province: '省・中央直轄市',
                ward: '町・村・坊',
                loading: '読み込み中...',
                selectProvince: '省・市を選択',
                selectWard: '町・村・坊を選択',
                loadError: '住所データを読み込めませんでした。',
                retry: '再試行',
            }
            : {
                detailPlaceholder: 'House number, street...',
                province: 'Province/City',
                ward: 'Ward/Commune',
                loading: 'Loading...',
                selectProvince: 'Select province/city',
                selectWard: 'Select ward/commune',
                loadError: 'Could not load address data.',
                retry: 'Retry',
            };

    const [provinces, setProvinces] = useState<Province[]>([]);
    const [wards, setWards] = useState<Ward[]>([]);

    const [selectedProvince, setSelectedProvince] = useState<string>(value?.provinceId?.toString() || '');
    const [selectedWard, setSelectedWard] = useState<string>(value?.wardCode || '');
    const [detail, setDetail] = useState(value?.detail || '');

    const [loadingProvinces, setLoadingProvinces] = useState(false);
    const [loadingWards, setLoadingWards] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [retryNonce, setRetryNonce] = useState(0);
    const onChangeRef = useRef(onChange);
    const lastEmittedRef = useRef<string | null>(null);

    /**
     * The address this picker was mounted with, kept for the whole life of the
     * instance.
     *
     * Radix resolves a Select's label from its items, so a list that has not
     * arrived leaves an edit form showing empty selects, `emitChange` resolves
     * nothing, reports `null` upward, and the parent clears the very row the
     * user opened. Seeding the lists from what was already saved keeps the form
     * readable regardless.
     *
     * It matters more since the reorganisation than it did before: an address
     * saved under the old 63-province map may name a province or ward that no
     * longer exists, and showing the reader what they saved beats showing them
     * a blank box.
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
        setSelectedWard(value.wardCode || '');
        setDetail(value.detail || '');
    }, [value?.provinceId, value?.wardCode, value?.detail]);

    useEffect(() => {
        const fetchProvinces = async () => {
            setLoadingProvinces(true);
            setLoadError('');
            try {
                const res = await fetch('/api/address/provinces');
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || copy.loadError);
                setProvinces(data.data || []);
            } catch (err) {
                console.error('Failed to fetch provinces:', err);
                setLoadError(copy.loadError);
            } finally {
                setLoadingProvinces(false);
            }
        };
        fetchProvinces();
    }, [retryNonce]);

    useEffect(() => {
        if (!selectedProvince) {
            setWards([]);
            return;
        }
        const fetchWards = async () => {
            setLoadingWards(true);
            setLoadError('');
            try {
                const res = await fetch(`/api/address/wards?province_code=${selectedProvince}`);
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
    }, [selectedProvince, retryNonce]);

    const provinceOptions = useMemo(() => {
        const saved = initialRef.current;
        const list = provinces.slice();
        if (saved?.provinceId && saved.provinceName && !list.some(p => p.code === saved.provinceId)) {
            list.push({ code: saved.provinceId, name: saved.provinceName });
        }
        return list;
    }, [provinces]);

    const wardOptions = useMemo(() => {
        const saved = initialRef.current;
        const list = wards.slice();
        // Only while the saved province is still the selected one — once the
        // user picks a different province the saved ward is not an option.
        if (
            saved?.wardCode && saved.wardName &&
            saved.provinceId?.toString() === selectedProvince &&
            !list.some(w => w.code.toString() === saved.wardCode)
        ) {
            list.push({ code: Number(saved.wardCode), name: saved.wardName });
        }
        return list;
    }, [wards, selectedProvince]);

    const emitChange = useCallback((pId: string, wCode: string, det: string) => {
        const province = provinceOptions.find(p => p.code.toString() === pId);
        const ward = wardOptions.find(w => w.code.toString() === wCode);
        const nextKey = province && ward ? `${province.code}|${ward.code}|${det}` : 'null';

        if (lastEmittedRef.current === nextKey) return;
        lastEmittedRef.current = nextKey;

        if (province && ward) {
            onChangeRef.current({
                provinceId: province.code,
                provinceName: province.name,
                wardCode: ward.code.toString(),
                wardName: ward.name,
                detail: det,
            });
        } else {
            onChangeRef.current(null);
        }
    }, [provinceOptions, wardOptions]);

    useEffect(() => {
        if (selectedProvince && selectedWard) {
            emitChange(selectedProvince, selectedWard, detail);
        }
    }, [selectedWard, detail, emitChange, selectedProvince]);

    const handleProvinceChange = (val: string) => {
        setSelectedProvince(val);
        setSelectedWard('');
        setWards([]);
        lastEmittedRef.current = null;
        onChangeRef.current(null);
    };

    const handleWardChange = (val: string) => {
        setSelectedWard(val);
    };

    const gridCols = compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

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
                                    <SelectItem key={p.code} value={p.code.toString()}>
                                        {p.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>

                <div>
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">{copy.ward}</Label>}
                    <Select
                        value={selectedWard}
                        onValueChange={handleWardChange}
                        disabled={!selectedProvince}
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
                                    <SelectItem key={w.code} value={w.code.toString()}>
                                        {w.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>
            </div>

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
