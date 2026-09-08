'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

/**
 * What the carriers would charge, from this seller's pickup address to a chosen
 * destination.
 *
 * Read-only by construction: quoting asks GoShip a question, where booking
 * sends a courier to somebody's door. Keeping the two apart is what makes this
 * safe to leave in front of a seller while the booking flow is unfinished.
 *
 * Only city and district are collected — a quote does not need a ward, and
 * asking for one would be three dropdowns to answer a question that takes two.
 */

type Option = { code: string; name: string };
type Rate = {
    id: string; carrierName: string; carrierCode: string;
    service: string; totalFee: number; expected: string | null; successPercent: number | null;
};

const COPY = {
    'vi-VN': {
        title: 'Thử bảng giá vận chuyển', city: 'Tỉnh/Thành nhận', district: 'Quận/Huyện nhận',
        selectCity: 'Chọn tỉnh/thành', selectDistrict: 'Chọn quận/huyện',
        weight: 'Cân nặng (gram)', submit: 'Xem giá', loading: 'Đang tính...',
        noPickup: 'Bạn cần lưu địa chỉ lấy hàng ở trên trước khi xem giá.',
        none: 'Không có hãng nào phục vụ tuyến này.', failed: 'Không lấy được bảng giá.',
        success: 'giao thành công', days: '',
        hint: 'Chỉ tra giá, không tạo vận đơn và không gọi shipper.',
    },
    'en-US': {
        title: 'Try the shipping rates', city: 'Destination province/city', district: 'Destination district',
        selectCity: 'Select province/city', selectDistrict: 'Select district',
        weight: 'Weight (grams)', submit: 'Get rates', loading: 'Calculating...',
        noPickup: 'Save the pickup address above before checking rates.',
        none: 'No carrier serves this route.', failed: 'Could not fetch the rates.',
        success: 'delivered', days: '',
        hint: 'Rates only — nothing is booked and no courier is called.',
    },
    'ja-JP': {
        title: '配送料金を試算', city: '配送先の省/市', district: '配送先の郡/区',
        selectCity: '省/市を選択', selectDistrict: '郡/区を選択',
        weight: '重量（グラム）', submit: '料金を見る', loading: '計算中...',
        noPickup: '先に上の集荷先住所を保存してください。',
        none: 'この経路に対応する業者がありません。', failed: '料金を取得できませんでした。',
        success: '配達成功', days: '',
        hint: '料金の確認のみ。送り状は作成されず、集荷も依頼しません。',
    },
} as const;

export function ShippingQuotePreview() {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [cities, setCities] = useState<Option[]>([]);
    const [districts, setDistricts] = useState<Option[]>([]);
    const [city, setCity] = useState('');
    const [district, setDistrict] = useState('');
    const [weight, setWeight] = useState('200');
    const [rates, setRates] = useState<Rate[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/shipping/address/cities', { cache: 'force-cache' })
            .then((r) => r.json()).then((b) => setCities(b.data ?? [])).catch(() => {});
    }, []);

    useEffect(() => {
        setDistrict('');
        setRates(null);
        if (!city) { setDistricts([]); return; }
        fetch(`/api/shipping/address/districts?city_code=${encodeURIComponent(city)}`, { cache: 'force-cache' })
            .then((r) => r.json()).then((b) => setDistricts(b.data ?? [])).catch(() => {});
    }, [city]);

    const run = async () => {
        setBusy(true); setError(null); setRates(null);
        try {
            const res = await fetch('/api/shipping/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: { city, district }, weight: Number(weight) || 200 }),
            });
            const body = await res.json();
            if (!res.ok) {
                // The one failure a seller can act on gets its own sentence.
                setError(body.code === 'missing_goship_pickup' ? copy.noPickup : (body.error || copy.failed));
                return;
            }
            setRates(body.data ?? []);
        } catch {
            setError(copy.failed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4 rounded-lg border border-border/60 p-4">
            <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-orange-400" />
                <h4 className="font-medium">{copy.title}</h4>
            </div>
            <p className="text-xs text-muted-foreground">{copy.hint}</p>

            <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                    <Label htmlFor="quote-city">{copy.city}</Label>
                    <Select value={city || undefined} onValueChange={setCity}>
                        <SelectTrigger id="quote-city"><SelectValue placeholder={copy.selectCity} /></SelectTrigger>
                        <SelectContent>
                            {cities.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="quote-district">{copy.district}</Label>
                    <Select value={district || undefined} onValueChange={setDistrict} disabled={!city}>
                        <SelectTrigger id="quote-district"><SelectValue placeholder={copy.selectDistrict} /></SelectTrigger>
                        <SelectContent>
                            {districts.map((d) => <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="quote-weight">{copy.weight}</Label>
                    <Input id="quote-weight" value={weight} inputMode="numeric"
                        onChange={(e) => setWeight(e.target.value.replace(/\D/g, '').slice(0, 5))} />
                </div>
            </div>

            <Button onClick={run} disabled={!city || !district || busy}>
                {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{copy.loading}</> : copy.submit}
            </Button>

            {error && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />{error}
                </p>
            )}

            {rates && rates.length === 0 && (
                <p className="text-sm text-muted-foreground">{copy.none}</p>
            )}

            {rates && rates.length > 0 && (
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                    {rates.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                            <div className="min-w-0">
                                <p className="truncate font-medium">{r.carrierName}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {[r.service, r.expected, r.successPercent != null ? `${r.successPercent}% ${copy.success}` : null]
                                        .filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <span className="shrink-0 font-semibold text-orange-400">
                                {r.totalFee.toLocaleString('vi-VN')}đ
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
