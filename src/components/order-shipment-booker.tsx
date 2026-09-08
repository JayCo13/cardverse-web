'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

/**
 * Create the waybill for one paid order.
 *
 * The seller presses this rather than it firing on payment. GoShip's flow
 * dispatches a courier — 901 chờ lấy hàng, 902 lấy hàng — so booking the moment
 * a buyer pays at 2am sends someone to a seller who has not packed yet. The
 * 24-hour ship deadline already says when it has to happen; this says who
 * decides the moment.
 *
 * Rates are fetched fresh when the dialog opens and again if the weight
 * changes, because GoShip's rate ids expire and the price shown has to be the
 * price booked.
 */

type Rate = {
    id: string; carrierName: string; carrierCode: string;
    service: string; totalFee: number; expected: string | null; successPercent: number | null;
};

const COPY = {
    'vi-VN': {
        title: 'Tạo vận đơn', open: 'Tạo vận đơn',
        desc: 'Chọn đơn vị vận chuyển. Sau khi tạo, bạn mang mã ra bưu cục gửi hoặc chờ shipper tới lấy.',
        weight: 'Cân nặng (gram)', declared: 'Khai giá (đ)',
        declaredHint: 'Giá trị hàng khai với đơn vị vận chuyển. Mặc định theo giá trị đơn.',
        loading: 'Đang lấy bảng giá...', none: 'Không có hãng nào phục vụ tuyến này.',
        book: 'Đặt', booking: 'Đang tạo...', cancel: 'Đóng',
        noPickup: 'Bạn cần lưu Thông tin người gửi ở trang Bán hàng trước.',
        noDest: 'Đơn này chưa có địa giới theo đơn vị vận chuyển, không đặt được vận đơn qua sàn.',
        failed: 'Không tạo được vận đơn.', done: 'Đã tạo vận đơn.',
        success: 'giao thành công',
    },
    'en-US': {
        title: 'Create waybill', open: 'Create waybill',
        desc: 'Pick a carrier. Once created, drop the parcel off with the code or wait for the courier.',
        weight: 'Weight (grams)', declared: 'Declared value (đ)',
        declaredHint: 'The value declared to the carrier. Defaults to the order total.',
        loading: 'Fetching rates...', none: 'No carrier serves this route.',
        book: 'Book', booking: 'Creating...', cancel: 'Close',
        noPickup: 'Save your sender details on the Sell page first.',
        noDest: 'This order has no carrier divisions, so it cannot be booked through the platform.',
        failed: 'Could not create the waybill.', done: 'Waybill created.',
        success: 'delivered',
    },
    'ja-JP': {
        title: '送り状を作成', open: '送り状を作成',
        desc: '配送業者を選んでください。作成後は窓口へ持ち込むか集荷をお待ちください。',
        weight: '重量（グラム）', declared: '申告価格（đ）',
        declaredHint: '業者に申告する価格。既定は注文金額です。',
        loading: '料金を取得中...', none: 'この経路に対応する業者がありません。',
        book: '作成', booking: '作成中...', cancel: '閉じる',
        noPickup: '先に販売ページで差出人情報を保存してください。',
        noDest: 'この注文には配送業者の行政区分がないため、作成できません。',
        failed: '作成できませんでした。', done: '送り状を作成しました。',
        success: '配達成功',
    },
} as const;

export function OrderShipmentBooker({
    orderId,
    destination,
    defaultDeclaredValue,
    onBooked,
}: {
    orderId: string;
    /** The order's to_goship. Null means it predates the carrier ids. */
    destination: { city: string; district: string; ward: string } | null;
    defaultDeclaredValue: number;
    onBooked: (gcode: string) => void;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [open, setOpen] = useState(false);
    const [weight, setWeight] = useState('200');
    const [declared, setDeclared] = useState(String(Math.max(0, Math.round(defaultDeclaredValue))));
    const [rates, setRates] = useState<Rate[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const quote = useCallback(async () => {
        if (!destination) return;
        setBusy(true); setError(null); setRates(null);
        try {
            const res = await fetch('/api/shipping/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: destination, weight: Number(weight) || 200 }),
            });
            const body = await res.json();
            if (!res.ok) {
                setError(body.code === 'missing_goship_pickup' ? copy.noPickup : (body.error || copy.failed));
                return;
            }
            setRates(body.data ?? []);
        } catch {
            setError(copy.failed);
        } finally {
            setBusy(false);
        }
    }, [destination, weight, copy.noPickup, copy.failed]);

    // Quotes go stale, so they are taken when the dialog opens rather than held
    // from an earlier visit.
    useEffect(() => { if (open) void quote(); }, [open, quote]);

    const book = async (rate: Rate) => {
        setBookingId(rate.id); setError(null);
        try {
            const res = await fetch('/api/shipping/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId,
                    rateId: rate.id,
                    weight: Number(weight) || 200,
                    declaredValue: Number(declared) || defaultDeclaredValue,
                    to: destination,
                }),
            });
            const body = await res.json();
            if (!res.ok) {
                // A stale rate is worth re-quoting rather than retrying.
                if (body.code === 'stale_rate') { setError(body.error); void quote(); return; }
                setError(body.error || copy.failed);
                return;
            }
            onBooked(body.gcode);
            setOpen(false);
        } catch {
            setError(copy.failed);
        } finally {
            setBookingId(null);
        }
    };

    return (
        <>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                <Truck className="h-3 w-3 mr-1" />{copy.open}
            </Button>

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{copy.title}</DialogTitle>
                        <DialogDescription>{copy.desc}</DialogDescription>
                    </DialogHeader>

                    {!destination ? (
                        <p className="flex items-center gap-2 text-sm text-amber-400">
                            <AlertCircle className="h-4 w-4 shrink-0" />{copy.noDest}
                        </p>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="osb-weight">{copy.weight}</Label>
                                    <Input id="osb-weight" value={weight} inputMode="numeric"
                                        onChange={(e) => setWeight(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                        onBlur={() => void quote()} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="osb-declared">{copy.declared}</Label>
                                    <Input id="osb-declared" value={declared} inputMode="numeric"
                                        onChange={(e) => setDeclared(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                                    <p className="text-xs text-muted-foreground">{copy.declaredHint}</p>
                                </div>
                            </div>

                            {error && (
                                <p className="flex items-center gap-2 text-sm text-destructive">
                                    <AlertCircle className="h-4 w-4 shrink-0" />{error}
                                </p>
                            )}

                            {busy && (
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />{copy.loading}
                                </p>
                            )}

                            {rates && rates.length === 0 && !busy && (
                                <p className="text-sm text-muted-foreground">{copy.none}</p>
                            )}

                            {rates && rates.length > 0 && (
                                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                                    {rates.map((r) => (
                                        <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                                            <div className="min-w-0">
                                                <p className="truncate font-medium">{r.carrierName}</p>
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {[r.service, r.expected,
                                                      r.successPercent != null ? `${r.successPercent}% ${copy.success}` : null]
                                                        .filter(Boolean).join(' · ')}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-3">
                                                <span className="font-semibold text-orange-400">
                                                    {r.totalFee.toLocaleString('vi-VN')}đ
                                                </span>
                                                <Button size="sm" disabled={!!bookingId}
                                                    onClick={() => book(r)}>
                                                    {bookingId === r.id
                                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                                        : copy.book}
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>{copy.cancel}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
