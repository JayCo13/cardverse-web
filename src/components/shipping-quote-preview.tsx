'use client';

import { useEffect, useState } from 'react';
import { carrierAddressOptions } from '@/lib/carrier-address-options';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AlertCircle, ChevronDown, Loader2, Truck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
        missing: 'Còn thiếu: {fields}', fWard: 'phường/xã', fStreet: 'địa chỉ', fName: 'tên người nhận', fPhone: 'số điện thoại hợp lệ', fDeclared: 'khai giá',
        ward: 'Phường/Xã nhận', selectWard: 'Chọn phường/xã',
        street: 'Địa chỉ cụ thể', name: 'Tên người nhận', phone: 'Số điện thoại nhận',
        declared: 'Khai giá (đ)', declaredHint: 'Giá trị hàng khai với hãng, dùng để bồi thường nếu mất. Trên ngưỡng nhất định hãng thu thêm phí bảo hiểm. Đổi số này rồi bấm Xem giá lại để thấy giá đúng.',
        book: 'Đặt vận đơn', confirmTitle: 'Đặt vận đơn thật?',
        confirmBody: 'Lệnh này tạo vận đơn thật với {carrier} ({fee}) và shipper sẽ tới địa chỉ người gửi để lấy hàng. Bạn vẫn có thể mang hàng ra bưu cục gửi bằng mã này.',
        confirm: 'Đặt', cancel: 'Huỷ', booked: 'Đã tạo vận đơn.', bookFailed: 'Không tạo được vận đơn.',
        title: 'Thử bảng giá vận chuyển', city: 'Tỉnh/Thành nhận', district: 'Quận/Huyện nhận',
        selectCity: 'Chọn tỉnh/thành', selectDistrict: 'Chọn quận/huyện',
        weight: 'Cân nặng (gram)', submit: 'Xem giá', loading: 'Đang tính...',
        noPickup: 'Bạn cần lưu địa chỉ lấy hàng ở trên trước khi xem giá.',
        none: 'Không có hãng nào phục vụ tuyến này.', failed: 'Không lấy được bảng giá.',
        success: 'giao thành công', days: '',
        hint: 'Chỉ tra giá, không tạo vận đơn và không gọi shipper.',
        open: 'Mở thử giá', close: 'Ẩn thử giá', recipient: 'Thông tin người nhận để đặt vận đơn',
    },
    'en-US': {
        missing: 'Still needed: {fields}', fWard: 'ward', fStreet: 'street address', fName: 'recipient name', fPhone: 'a valid phone number', fDeclared: 'declared value',
        ward: 'Destination ward', selectWard: 'Select ward',
        street: 'Street address', name: 'Recipient name', phone: 'Recipient phone',
        declared: 'Declared value (đ)', declaredHint: 'Declared to the carrier and what it pays if the parcel is lost. Above a threshold the carrier charges for it — re-run the quote after changing this.',
        book: 'Book shipment', confirmTitle: 'Book a real shipment?',
        confirmBody: 'This creates a real waybill with {carrier} ({fee}) and a courier will come to the sender address. You can still drop the parcel off using this code.',
        confirm: 'Book', cancel: 'Cancel', booked: 'Shipment created.', bookFailed: 'Could not create the shipment.',
        title: 'Try the shipping rates', city: 'Destination province/city', district: 'Destination district',
        selectCity: 'Select province/city', selectDistrict: 'Select district',
        weight: 'Weight (grams)', submit: 'Get rates', loading: 'Calculating...',
        noPickup: 'Save the pickup address above before checking rates.',
        none: 'No carrier serves this route.', failed: 'Could not fetch the rates.',
        success: 'delivered', days: '',
        hint: 'Rates only — nothing is booked and no courier is called.',
        open: 'Open rate checker', close: 'Hide rate checker', recipient: 'Recipient details for booking',
    },
    'ja-JP': {
        missing: '不足: {fields}', fWard: '坊/社', fStreet: '住所', fName: '受取人名', fPhone: '有効な電話番号', fDeclared: '申告価格',
        ward: '配送先の坊/社', selectWard: '坊/社を選択',
        street: '詳細住所', name: '受取人名', phone: '受取人の電話番号',
        declared: '申告価格（đ）', declaredHint: '業者への申告価格で、紛失時の補償額です。一定額を超えると保険料が加算されます。変更後は再度料金を確認してください。',
        book: '送り状を作成', confirmTitle: '実際に送り状を作成しますか？',
        confirmBody: '{carrier}（{fee}）で実際の送り状を作成し、集荷に伺います。この番号で窓口へ持ち込むこともできます。',
        confirm: '作成', cancel: 'キャンセル', booked: '送り状を作成しました。', bookFailed: '作成できませんでした。',
        title: '配送料金を試算', city: '配送先の省/市', district: '配送先の郡/区',
        selectCity: '省/市を選択', selectDistrict: '郡/区を選択',
        weight: '重量（グラム）', submit: '料金を見る', loading: '計算中...',
        noPickup: '先に上の集荷先住所を保存してください。',
        none: 'この経路に対応する業者がありません。', failed: '料金を取得できませんでした。',
        success: '配達成功', days: '',
        hint: '料金の確認のみ。送り状は作成されず、集荷も依頼しません。',
        open: '料金試算を開く', close: '料金試算を閉じる', recipient: '送り状作成の受取人情報',
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
    const [wards, setWards] = useState<Option[]>([]);
    const [ward, setWard] = useState('');
    const [street, setStreet] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [declared, setDeclared] = useState('');
    const [confirming, setConfirming] = useState<Rate | null>(null);
    const [booking, setBooking] = useState(false);
    const [booked, setBooked] = useState<Record<string, unknown> | null>(null);
    const [rates, setRates] = useState<Rate[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);

    // Through the shared client cache: the sender form above has usually
    // fetched the same city list a moment ago, and there is no reason to
    // reach GoShip for it twice on one page.
    useEffect(() => {
        carrierAddressOptions('/api/shipping/address/cities')
            .then(setCities).catch(() => {});
    }, []);

    useEffect(() => {
        setDistrict('');
        setRates(null);
        if (!city) { setDistricts([]); return; }
        carrierAddressOptions(`/api/shipping/address/districts?city_code=${encodeURIComponent(city)}`)
            .then(setDistricts).catch(() => {});
    }, [city]);

    useEffect(() => {
        setWard('');
        if (!district) { setWards([]); return; }
        carrierAddressOptions(`/api/shipping/address/wards?district_code=${encodeURIComponent(district)}`)
            .then(setWards).catch(() => {});
    }, [district]);

    const run = async () => {
        setBusy(true); setError(null); setRates(null);
        try {
            const res = await fetch('/api/shipping/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: { city, district },
                    weight: Number(weight) || 200,
                    declaredValue: Number(declared) || 0,
                }),
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

    // Naming what is missing rather than greying the button out and leaving the
    // reader to guess. A disabled control with no reason is the same as a
    // broken one to whoever is looking at it.
    const missingFields = [
        !ward && copy.fWard,
        !street.trim() && copy.fStreet,
        !name.trim() && copy.fName,
        !/^0[0-9]{8,10}$/.test(phone.replace(/\s+/g, '')) && copy.fPhone,
        !(Number(declared) > 0) && copy.fDeclared,
    ].filter(Boolean) as string[];
    const canBook = missingFields.length === 0;

    const book = async (rate: Rate) => {
        setBooking(true); setError(null);
        try {
            const res = await fetch('/api/shipping/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rateId: rate.id,
                    weight: Number(weight) || 200,
                    declaredValue: Number(declared),
                    to: { city, district, ward, street, name, phone },
                }),
            });
            const body = await res.json();
            if (!res.ok) { setError(body.error || copy.bookFailed); return; }
            setBooked(body.data);
        } catch {
            setError(copy.bookFailed);
        } finally {
            setBooking(false);
            setConfirming(null);
        }
    };

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/60">
            <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-accent/40">
                    <span className="flex min-w-0 items-center gap-2">
                        <Truck className="h-4 w-4 shrink-0 text-orange-400" />
                        <span className="min-w-0">
                            <span className="block font-medium">{copy.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{copy.hint}</span>
                        </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {open ? copy.close : copy.open}
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t border-border/60 p-4">

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

            {/* Only asked for once there is something to book: a quote needs a
                district, a waybill needs a person to hand the parcel to. */}
            {rates && rates.length > 0 && (
                <Collapsible open={bookingDetailsOpen} onOpenChange={setBookingDetailsOpen} className="rounded-md border border-border/60">
                    <CollapsibleTrigger asChild>
                        <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm font-medium hover:bg-accent/40">
                            {copy.recipient}
                            <ChevronDown className={`h-4 w-4 transition-transform ${bookingDetailsOpen ? 'rotate-180' : ''}`} />
                        </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 border-t border-border/60 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="q-ward">{copy.ward}</Label>
                            <Select value={ward || undefined} onValueChange={setWard}>
                                <SelectTrigger id="q-ward"><SelectValue placeholder={copy.selectWard} /></SelectTrigger>
                                <SelectContent>
                                    {wards.map((w) => <SelectItem key={w.code} value={w.code}>{w.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="q-street">{copy.street}</Label>
                            <Input id="q-street" value={street} maxLength={255}
                                onChange={(e) => setStreet(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="q-name">{copy.name}</Label>
                            <Input id="q-name" value={name} maxLength={120}
                                onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="q-phone">{copy.phone}</Label>
                            <Input id="q-phone" value={phone} inputMode="tel" maxLength={15}
                                onChange={(e) => setPhone(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="q-declared">{copy.declared}</Label>
                        <Input id="q-declared" value={declared} inputMode="numeric"
                            onChange={(e) => setDeclared(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                        <p className="text-xs text-muted-foreground">{copy.declaredHint}</p>
                    </div>
                    {missingFields.length > 0 && (
                        <p className="flex items-center gap-2 text-xs text-amber-400">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            {copy.missing.replace('{fields}', missingFields.join(', '))}
                        </p>
                    )}
                    </CollapsibleContent>
                </Collapsible>
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
                            <div className="flex shrink-0 items-center gap-3">
                                <span className="font-semibold text-orange-400">
                                    {r.totalFee.toLocaleString('vi-VN')}đ
                                </span>
                                <Button size="sm" variant="outline"
                                    disabled={!canBook}
                                    onClick={() => setConfirming(r)}>
                                    {copy.book}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {booked && (
                <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                    {JSON.stringify(booked, null, 2)}
                </pre>
            )}

            <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{copy.confirmTitle}</DialogTitle>
                        <DialogDescription>
                            {copy.confirmBody
                                .replace('{carrier}', confirming?.carrierName ?? '')
                                .replace('{fee}', `${(confirming?.totalFee ?? 0).toLocaleString('vi-VN')}đ`)}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirming(null)} disabled={booking}>
                            {copy.cancel}
                        </Button>
                        <Button className="bg-orange-500 hover:bg-orange-600" disabled={booking}
                            onClick={() => confirming && book(confirming)}>
                            {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.confirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </CollapsibleContent>
        </Collapsible>
    );
}
