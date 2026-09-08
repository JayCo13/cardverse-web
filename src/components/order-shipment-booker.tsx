'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { PackingVideoField } from '@/components/packing-video-field';
import { GoshipRegionPicker, type GoshipRegion } from '@/components/goship-region-picker';

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
        pickRegion: 'Đơn này chưa có địa giới theo đơn vị vận chuyển. Chọn theo địa chỉ người nhận trên đơn:',
        buyerPaid: 'Người mua đã trả', youPay: 'Bạn trả thêm', youKeep: 'Bạn dư',
        title: 'Tạo vận đơn', open: 'Tạo vận đơn',
        desc: 'Chọn đơn vị vận chuyển. Sau khi tạo, bạn mang mã ra bưu cục gửi hoặc chờ shipper tới lấy.',
        weight: 'Cân nặng (gram)', declared: 'Khai giá (đ)',
        declaredHint: 'Giá trị hàng khai với hãng, dùng để bồi thường nếu mất. Trên ngưỡng nhất định hãng thu thêm phí bảo hiểm — giá bên dưới đã gồm khoản đó.',
        loading: 'Đang lấy bảng giá...', none: 'Không có hãng nào phục vụ tuyến này.',
        book: 'Đặt', booking: 'Đang tạo...', cancel: 'Đóng',
        noPickup: 'Bạn cần lưu Thông tin người gửi ở trang Bán hàng trước.',
        noDest: 'Đơn này chưa có địa giới theo đơn vị vận chuyển, không đặt được vận đơn qua sàn.',
        failed: 'Không tạo được vận đơn.', done: 'Đã tạo vận đơn.',
        success: 'giao thành công',
    },
    'en-US': {
        pickRegion: 'This order has no carrier divisions yet. Pick them from the delivery address on the order:',
        buyerPaid: 'Buyer paid', youPay: 'You cover', youKeep: 'You keep',
        title: 'Create waybill', open: 'Create waybill',
        desc: 'Pick a carrier. Once created, drop the parcel off with the code or wait for the courier.',
        weight: 'Weight (grams)', declared: 'Declared value (đ)',
        declaredHint: 'Declared to the carrier and what it pays if the parcel is lost. Above a threshold the carrier charges for it — the prices below already include that.',
        loading: 'Fetching rates...', none: 'No carrier serves this route.',
        book: 'Book', booking: 'Creating...', cancel: 'Close',
        noPickup: 'Save your sender details on the Sell page first.',
        noDest: 'This order has no carrier divisions, so it cannot be booked through the platform.',
        failed: 'Could not create the waybill.', done: 'Waybill created.',
        success: 'delivered',
    },
    'ja-JP': {
        pickRegion: 'この注文には配送業者の行政区分がありません。注文の配送先に合わせて選んでください：',
        buyerPaid: '購入者支払い', youPay: '差額負担', youKeep: '差額',
        title: '送り状を作成', open: '送り状を作成',
        desc: '配送業者を選んでください。作成後は窓口へ持ち込むか集荷をお待ちください。',
        weight: '重量（グラム）', declared: '申告価格（đ）',
        declaredHint: '業者への申告価格で、紛失時の補償額です。一定額を超えると保険料が加算され、下の料金に含まれます。',
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
    buyerPaidShipping,
    onBooked,
}: {
    orderId: string;
    /** The order's to_goship. Null means it predates the carrier ids. */
    destination: { city: string; district: string; ward: string } | null;
    defaultDeclaredValue: number;
    /** What the buyer already paid for shipping on this order. */
    buyerPaidShipping: number;
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
    // Evidence, carried over from the ship form this replaces:
    // dispute_evidence_verdict reads it as the seller's side of the story.
    const [packingVideo, setPackingVideo] = useState<string | null>(null);
    // Only used when the order has none. The seller is holding the buyer's
    // address on the order in front of them, so they are the one who can say
    // which of the carrier's districts it falls in.
    const [pickedRegion, setPickedRegion] = useState<GoshipRegion | null>(null);
    const region = destination ?? pickedRegion;

    const quote = useCallback(async () => {
        if (!region) return;
        setBusy(true); setError(null); setRates(null);
        try {
            const res = await fetch('/api/shipping/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: region,
                    weight: Number(weight) || 200,
                    // Priced with the declared value: the carrier charges for it
                    // above a threshold, so a quote without one understates.
                    declaredValue: Number(declared) || 0,
                }),
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
    }, [region, weight, declared, copy.noPickup, copy.failed]);

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
                    to: region,
                    packingVideoUrl: packingVideo,
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

                    {!region ? (
                        <div className="space-y-3">
                            <p className="flex items-start gap-2 text-sm text-amber-400">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{copy.pickRegion}
                            </p>
                            <GoshipRegionPicker idPrefix={`osb-${orderId}`} onChange={setPickedRegion} />
                        </div>
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
                                        onChange={(e) => setDeclared(e.target.value.replace(/\D/g, '').slice(0, 9))}
                                        onBlur={() => void quote()} />
                                    <p className="text-xs text-muted-foreground">{copy.declaredHint}</p>
                                </div>
                            </div>

                            <PackingVideoField value={packingVideo} onChange={setPackingVideo} locale={locale} />

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
                                <p className="text-xs text-muted-foreground">
                                    {copy.buyerPaid}: <span className="text-foreground">{buyerPaidShipping.toLocaleString('vi-VN')}đ</span>
                                </p>
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
                                                <div className="text-right">
                                                    <span className="font-semibold text-orange-400">
                                                        {r.totalFee.toLocaleString('vi-VN')}đ
                                                    </span>
                                                    {/* The seller's GoShip account is billed, not the
                                                        buyer's payment, so the gap between the two is
                                                        theirs either way. Shown per option because it
                                                        is what makes one carrier cheaper than another
                                                        for them, not for the buyer. */}
                                                    <p className={`text-xs ${r.totalFee > buyerPaidShipping ? 'text-amber-400' : 'text-green-400'}`}>
                                                        {r.totalFee > buyerPaidShipping
                                                            ? `${copy.youPay} ${(r.totalFee - buyerPaidShipping).toLocaleString('vi-VN')}đ`
                                                            : `${copy.youKeep} ${(buyerPaidShipping - r.totalFee).toLocaleString('vi-VN')}đ`}
                                                    </p>
                                                </div>
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
