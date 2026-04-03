'use client';

import { useState, useEffect, useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MapPin } from 'lucide-react';

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
    detailPlaceholder = 'Số nhà, đường...',
    compact = false,
    label,
}: AddressPickerProps) {
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

    // Load provinces on mount
    useEffect(() => {
        const fetchProvinces = async () => {
            setLoadingProvinces(true);
            try {
                const res = await fetch('/api/shipping/provinces');
                const data = await res.json();
                setProvinces(data.data || []);
            } catch (err) {
                console.error('Failed to fetch provinces:', err);
            } finally {
                setLoadingProvinces(false);
            }
        };
        fetchProvinces();
    }, []);

    // Load districts when province changes
    useEffect(() => {
        if (!selectedProvince) {
            setDistricts([]);
            return;
        }
        const fetchDistricts = async () => {
            setLoadingDistricts(true);
            try {
                const res = await fetch(`/api/shipping/districts?province_id=${selectedProvince}`);
                const data = await res.json();
                setDistricts(data.data || []);
            } catch (err) {
                console.error('Failed to fetch districts:', err);
            } finally {
                setLoadingDistricts(false);
            }
        };
        fetchDistricts();
    }, [selectedProvince]);

    // Load wards when district changes
    useEffect(() => {
        if (!selectedDistrict) {
            setWards([]);
            return;
        }
        const fetchWards = async () => {
            setLoadingWards(true);
            try {
                const res = await fetch(`/api/shipping/wards?district_id=${selectedDistrict}`);
                const data = await res.json();
                setWards(data.data || []);
            } catch (err) {
                console.error('Failed to fetch wards:', err);
            } finally {
                setLoadingWards(false);
            }
        };
        fetchWards();
    }, [selectedDistrict]);

    // Emit changes
    const emitChange = useCallback((
        pId: string, dId: string, wCode: string, det: string
    ) => {
        const province = provinces.find(p => p.ProvinceID.toString() === pId);
        const district = districts.find(d => d.DistrictID.toString() === dId);
        const ward = wards.find(w => w.WardCode === wCode);

        if (province && district && ward) {
            onChange({
                provinceId: province.ProvinceID,
                provinceName: province.ProvinceName,
                districtId: district.DistrictID,
                districtName: district.DistrictName,
                wardCode: ward.WardCode,
                wardName: ward.WardName,
                detail: det,
            });
        } else {
            onChange(null);
        }
    }, [provinces, districts, wards, onChange]);

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
        onChange(null);
    };

    const handleDistrictChange = (val: string) => {
        setSelectedDistrict(val);
        setSelectedWard('');
        setWards([]);
        onChange(null);
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

            <div className={`grid ${gridCols} gap-2`}>
                {/* Province */}
                <div>
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">Tỉnh/Thành</Label>}
                    <Select value={selectedProvince} onValueChange={handleProvinceChange}>
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingProvinces ? 'Đang tải...' : 'Chọn Tỉnh/Thành'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingProvinces ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                provinces
                                    .sort((a, b) => a.ProvinceName.localeCompare(b.ProvinceName))
                                    .map(p => (
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
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">Quận/Huyện</Label>}
                    <Select
                        value={selectedDistrict}
                        onValueChange={handleDistrictChange}
                        disabled={!selectedProvince}
                    >
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingDistricts ? 'Đang tải...' : 'Chọn Quận/Huyện'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingDistricts ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                districts
                                    .sort((a, b) => a.DistrictName.localeCompare(b.DistrictName))
                                    .map(d => (
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
                    {!compact && <Label className="text-xs text-muted-foreground mb-1 block">Phường/Xã</Label>}
                    <Select
                        value={selectedWard}
                        onValueChange={handleWardChange}
                        disabled={!selectedDistrict}
                    >
                        <SelectTrigger className="w-full h-9 text-sm">
                            <SelectValue placeholder={loadingWards ? 'Đang tải...' : 'Chọn Phường/Xã'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {loadingWards ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                wards
                                    .sort((a, b) => a.WardName.localeCompare(b.WardName))
                                    .map(w => (
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
                    placeholder={detailPlaceholder}
                    className="h-9 text-sm"
                />
            )}
        </div>
    );
}
