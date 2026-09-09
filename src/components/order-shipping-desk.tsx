'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, ArrowRight, Check, Loader2, MapPin, Package, PencilLine, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { PackingVideoField } from '@/components/packing-video-field';
import { GoshipRegionPicker, type GoshipRegion } from '@/components/goship-region-picker';

/**
 * Where a seller turns one paid order into a real waybill.
 *
 * A panel on the order page rather than a dialog over a list, because booking
 * is not a quick confirmation — it dispatches a courier to the seller's door,
 * bills their GoShip account, and prints an address a stranger will drive to.
 * A dialog invites a glance; the three steps below ask to be read: check who
 * this is going between, say what is in the parcel, then choose who carries it.
 *
 * Rates are re-quoted whenever weight or declared value changes, and again on
 * open, because GoShip's rate ids expire and the price shown has to be the
 * price booked.
 */

type Rate = {
    id: string; carrierName: string; carrierCode: string;
    service: string; totalFee: number; expected: string | null; successPercent: number | null;
};

type Pickup = { city: string; district: string; ward: string; street: string; name: string; phone: string };

const COPY = {
    'vi-VN': {
        heading: 'Tạo vận đơn', lead: 'Kiểm tra thông tin, chọn đơn vị vận chuyển, và sàn sẽ tạo mã vận đơn cho đơn này.',
        step1: 'Đối soát thông tin', step2: 'Thông tin gói hàng', step3: 'Chọn đơn vị vận chuyển',
        sender: 'Người gửi', recipient: 'Người nhận', item: 'Hàng trong gói',
        editSender: 'Sửa địa chỉ lấy hàng', senderMissing: 'Bạn chưa lưu địa chỉ lấy hàng. Lưu ở trang Bán hàng trước khi tạo vận đơn.',
        fromOrder: 'Lấy từ địa chỉ người mua đã nhập',
        weight: 'Cân nặng (gram)', weightHint: 'Cả gói, gồm hộp và lớp chống sốc. Một thẻ đã ép cứng thường 150–250g.',
        declared: 'Khai giá (đ)', declaredHint: 'Số tiền hãng bồi thường nếu mất hàng. Trên 2.500.000đ hãng thu thêm phí bảo hiểm, giá bên dưới đã gồm khoản đó.',
        pickRegion: 'Đơn này chưa có địa giới theo đơn vị vận chuyển. Chọn theo địa chỉ người nhận bên trên:',
        buyerPaid: 'Người mua đã trả', youPay: 'bạn bù', youKeep: 'bạn dư',
        loading: 'Đang lấy bảng giá...', none: 'Không có đơn vị vận chuyển nào phục vụ tuyến này.',
        success: 'giao thành công', chosen: 'Đã chọn',
        book: 'Tạo vận đơn', booking: 'Đang tạo...', pickFirst: 'Chọn một đơn vị vận chuyển',
        confirmTitle: 'Tạo vận đơn thật?',
        confirmBody: 'Sàn sẽ tạo vận đơn với {carrier}, cước {fee}. Shipper sẽ tới địa chỉ người gửi để lấy hàng, hoặc bạn mang mã ra bưu cục gửi.',
        confirm: 'Tạo vận đơn', cancel: 'Huỷ',
        failed: 'Không tạo được vận đơn.', noPickup: 'Bạn cần lưu địa chỉ lấy hàng ở trang Bán hàng trước.',
    },
    'en-US': {
        heading: 'Create the waybill', lead: 'Check the details, pick a carrier, and the platform books the shipment for this order.',
        step1: 'Check the details', step2: 'Parcel details', step3: 'Pick a carrier',
        sender: 'Sender', recipient: 'Recipient', item: 'In the parcel',
        editSender: 'Edit pickup address', senderMissing: 'No pickup address saved yet. Save one on the Sell page before booking.',
        fromOrder: 'From the address the buyer entered',
        weight: 'Weight (grams)', weightHint: 'The whole parcel, box and padding included. One slabbed card is usually 150–250g.',
        declared: 'Declared value (đ)', declaredHint: 'What the carrier pays if the parcel is lost. Above 2,500,000đ it charges insurance, already included in the prices below.',
        pickRegion: 'This order has no carrier divisions yet. Pick them from the recipient address above:',
        buyerPaid: 'Buyer paid', youPay: 'you cover', youKeep: 'you keep',
        loading: 'Fetching rates...', none: 'No carrier serves this route.',
        success: 'delivered', chosen: 'Selected',
        book: 'Create waybill', booking: 'Creating...', pickFirst: 'Pick a carrier',
        confirmTitle: 'Create a real waybill?',
        confirmBody: 'This books a shipment with {carrier} for {fee}. A courier will come to the pickup address, or you can drop the parcel off with the code.',
        confirm: 'Create waybill', cancel: 'Cancel',
        failed: 'Could not create the waybill.', noPickup: 'Save your pickup address on the Sell page first.',
    },
    'ja-JP': {
        heading: '送り状を作成', lead: '内容を確認し、配送業者を選ぶと、この注文の送り状が作成されます。',
        step1: '内容の確認', step2: '荷物の情報', step3: '配送業者の選択',
        sender: '差出人', recipient: '受取人', item: '荷物の中身',
        editSender: '集荷先を編集', senderMissing: '集荷先が未登録です。販売ページで登録してください。',
        fromOrder: '購入者が入力した住所',
        weight: '重量（グラム）', weightHint: '箱と緩衝材を含む全体。スラブ入りカード1枚で通常150〜250g。',
        declared: '申告価格（đ）', declaredHint: '紛失時の補償額です。2,500,000đを超えると保険料が加算され、下の料金に含まれます。',
        pickRegion: 'この注文には配送業者の行政区分がありません。上の受取人住所に合わせて選んでください：',
        buyerPaid: '購入者支払い', youPay: '差額負担', youKeep: '差額',
        loading: '料金を取得中...', none: 'この経路に対応する業者がありません。',
        success: '配達成功', chosen: '選択中',
        book: '送り状を作成', booking: '作成中...', pickFirst: '配送業者を選択してください',
        confirmTitle: '送り状を作成しますか？',
        confirmBody: '{carrier} で送り状を作成します（{fee}）。集荷に伺うか、コードで窓口へ持ち込めます。',
        confirm: '作成する', cancel: 'キャンセル',
        failed: '作成できませんでした。', noPickup: '先に販売ページで集荷先を保存してください。',
    },
} as const;

const fetchOptions = async (url: string): Promise<{ code: string; name: string }[]> => {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
};

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

export function OrderShippingDesk({
    orderId,
    destination,
    defaultDeclaredValue,
    buyerPaidShipping,
    recipient,
    itemName,
    onBooked,
}: {
    orderId: string;
    /** The order's to_goship. Null means it predates the carrier ids. */
    destination: GoshipRegion | null;
    defaultDeclaredValue: number;
    /** What the buyer already paid for shipping on this order. */
    buyerPaidShipping: number;
    recipient: { name: string; phone: string; address: string };
    itemName: string;
    onBooked: (gcode: string) => void;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [weight, setWeight] = useState('200');
    const [declared, setDeclared] = useState(String(Math.max(0, Math.round(defaultDeclaredValue))));
    const [rates, setRates] = useState<Rate[] | null>(null);
    const [chosen, setChosen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [booking, setBooking] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Evidence: dispute_evidence_verdict reads it as the seller's side.
    const [packingVideo, setPackingVideo] = useState<string | null>(null);
    const [pickedRegion, setPickedRegion] = useState<GoshipRegion | null>(null);
    const region = destination ?? pickedRegion;

    // The sender half of the reconciliation. Stored as GoShip ids, so the names
    // have to be looked up — an id tells the seller nothing about whether the
    // courier is coming to the right place.
    const [pickup, setPickup] = useState<Pickup | null | 'missing'>(null);
    const [pickupPlace, setPickupPlace] = useState<string>('');

    useEffect(() => {
        let off = false;
        (async () => {
            try {
                const res = await fetch('/api/shipping/pickup-address');
                const body = await res.json();
                const p = body?.data as Pickup | null;
                if (off) return;
                if (!p) { setPickup('missing'); return; }
                setPickup(p);
                const [cities, districts, wards] = await Promise.all([
                    fetchOptions('/api/shipping/address/cities'),
                    fetchOptions(`/api/shipping/address/districts?city_code=${encodeURIComponent(p.city)}`),
                    fetchOptions(`/api/shipping/address/wards?district_code=${encodeURIComponent(p.district)}`),
                ]);
                if (off) return;
                setPickupPlace([
                    p.street,
                    wards.find((w) => String(w.code) === String(p.ward))?.name,
                    districts.find((d) => String(d.code) === String(p.district))?.name,
                    cities.find((c) => String(c.code) === String(p.city))?.name,
                ].filter(Boolean).join(', '));
            } catch {
                if (!off) setPickup('missing');
            }
        })();
        return () => { off = true; };
    }, []);

    const quote = useCallback(async () => {
        if (!region) return;
        setBusy(true); setError(null); setRates(null); setChosen(null);
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

    useEffect(() => { void quote(); }, [quote]);

    const selected = useMemo(() => rates?.find((r) => r.id === chosen) ?? null, [rates, chosen]);

    const book = async () => {
        if (!selected) return;
        setBooking(true); setError(null);
        try {
            const res = await fetch('/api/shipping/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId,
                    rateId: selected.id,
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
            setConfirming(false);
            onBooked(body.gcode);
        } catch {
            setError(copy.failed);
        } finally {
            setBooking(false);
        }
    };

    const stepLabel = (n: number, label: string) => (
        <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-[11px] font-bold text-orange-400">{n}</span>
            {label}
        </h3>
    );

    return (
        <section className="overflow-hidden rounded-xl border border-orange-500/30 bg-card">
            <header className="border-b border-orange-500/20 bg-orange-500/[0.07] px-5 py-4">
                <h2 className="flex items-center gap-2 font-semibold">
                    <Truck className="h-5 w-5 text-orange-400" />{copy.heading}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.lead}</p>
            </header>

            {/* One column. The page puts this beside the order's own record
                rather than splitting it internally — two nested two-column
                layouts would leave four narrow strips on a wide screen. */}
            <div>
                <div className="space-y-6 p-5">
                    <div className="space-y-3">
                        {stepLabel(1, copy.step1)}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <Package className="h-3.5 w-3.5" />{copy.sender}
                                </p>
                                {pickup === 'missing' ? (
                                    <p className="text-sm text-amber-300">{copy.senderMissing}</p>
                                ) : pickup === null ? (
                                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />…
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-sm font-medium">{pickup.name} · {pickup.phone}</p>
                                        <p className="text-sm text-muted-foreground">{pickupPlace || pickup.street}</p>
                                    </>
                                )}
                                <Link href="/sell#shop-shipping" className="mt-2 inline-flex items-center gap-1 text-xs text-orange-400 hover:underline">
                                    <PencilLine className="h-3 w-3" />{copy.editSender}
                                </Link>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <MapPin className="h-3.5 w-3.5" />{copy.recipient}
                                </p>
                                <p className="text-sm font-medium">{recipient.name} · {recipient.phone}</p>
                                <p className="text-sm text-muted-foreground">{recipient.address}</p>
                                <p className="mt-2 text-xs text-muted-foreground/70">{copy.fromOrder}</p>
                            </div>
                        </div>
                        <p className="text-sm">
                            <span className="text-muted-foreground">{copy.item}: </span>
                            <span className="font-medium">{itemName}</span>
                        </p>
                    </div>

                    <div className="space-y-3">
                        {stepLabel(2, copy.step2)}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="osd-weight">{copy.weight}</Label>
                                <Input id="osd-weight" value={weight} inputMode="numeric"
                                    onChange={(e) => setWeight(e.target.value.replace(/\D/g, '').slice(0, 5))} />
                                <p className="text-xs text-muted-foreground">{copy.weightHint}</p>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="osd-declared">{copy.declared}</Label>
                                <Input id="osd-declared" value={declared} inputMode="numeric"
                                    onChange={(e) => setDeclared(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                                <p className="text-xs text-muted-foreground">{copy.declaredHint}</p>
                            </div>
                        </div>
                        <PackingVideoField value={packingVideo} onChange={setPackingVideo} locale={locale} />
                    </div>
                </div>

                {/* Choosing a carrier, under what is being sent. */}
                <div className="border-t border-border/60 bg-background/40">
                    <div>
                        <div className="space-y-3 p-5">
                            {stepLabel(3, copy.step3)}

                            {!region ? (
                                <div className="space-y-3">
                                    <p className="flex items-start gap-2 text-sm text-amber-400">
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{copy.pickRegion}
                                    </p>
                                    <GoshipRegionPicker idPrefix={`osd-${orderId}`} onChange={setPickedRegion} />
                                </div>
                            ) : (
                                <>
                                    <p className="text-xs text-muted-foreground">
                                        {copy.buyerPaid}: <span className="font-medium text-foreground">{money(buyerPaidShipping)}</span>
                                    </p>

                                    {busy && (
                                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" />{copy.loading}
                                        </p>
                                    )}

                                    {rates && rates.length === 0 && !busy && (
                                        <p className="text-sm text-muted-foreground">{copy.none}</p>
                                    )}

                                    {rates && rates.length > 0 && (
                                        // No cap of its own: the column around this scrolls
                                        // now, and a scrollbar inside a scrollbar makes the
                                        // reader guess which one their wheel is driving.
                                        <ul className="space-y-2">
                                            {rates.map((r) => {
                                                const isChosen = r.id === chosen;
                                                const over = r.totalFee > buyerPaidShipping;
                                                return (
                                                    <li key={r.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setChosen(r.id)}
                                                            aria-pressed={isChosen}
                                                            className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                                                isChosen
                                                                    ? 'border-orange-500 bg-orange-500/10'
                                                                    : 'border-border/60 hover:border-orange-500/40 hover:bg-accent/40'
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isChosen ? 'border-orange-500 bg-orange-500 text-black' : 'border-muted-foreground/40'}`}>
                                                                    {isChosen && <Check className="h-3 w-3" />}
                                                                </span>
                                                                <span className="min-w-0 flex-1 truncate font-medium">{r.carrierName}</span>
                                                                <span className="shrink-0 font-semibold text-orange-400">{money(r.totalFee)}</span>
                                                            </span>
                                                            <span className="mt-1 flex items-center justify-between gap-2 pl-6">
                                                                <span className="min-w-0 truncate text-xs text-muted-foreground">
                                                                    {[r.service, r.expected,
                                                                      r.successPercent != null ? `${r.successPercent}% ${copy.success}` : null]
                                                                        .filter(Boolean).join(' · ')}
                                                                </span>
                                                                {/* The seller's GoShip account is billed, not the
                                                                    buyer's payment, so the gap between the two is
                                                                    theirs either way — and it is what makes one
                                                                    carrier cheaper than another for them. */}
                                                                <span className={`shrink-0 text-xs ${over ? 'text-amber-400' : 'text-green-400'}`}>
                                                                    {over
                                                                        ? `${copy.youPay} ${money(r.totalFee - buyerPaidShipping)}`
                                                                        : `${copy.youKeep} ${money(buyerPaidShipping - r.totalFee)}`}
                                                                </span>
                                                            </span>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </>
                            )}

                            {error && (
                                <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                                </p>
                            )}
                        </div>

                        {/* A courier gets dispatched from here, so the last press is
                            its own deliberate one rather than a row in a list. */}
                        <div className="space-y-3 border-t border-border/60 px-5 py-4">
                            <p className="text-sm text-muted-foreground">
                                {selected
                                    ? <>{copy.chosen}: <span className="font-medium text-foreground">{selected.carrierName}</span> · <span className="font-semibold text-orange-400">{money(selected.totalFee)}</span></>
                                    : copy.pickFirst}
                            </p>
                            <Button disabled={!selected} onClick={() => setConfirming(true)} className="w-full bg-orange-500 hover:bg-orange-600">
                                <Truck className="mr-2 h-4 w-4" />{copy.book}
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Dialog open={confirming} onOpenChange={(o) => { if (!booking) setConfirming(o); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{copy.confirmTitle}</DialogTitle>
                        <DialogDescription>
                            {copy.confirmBody
                                .replace('{carrier}', selected?.carrierName ?? '')
                                .replace('{fee}', selected ? money(selected.totalFee) : '')}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirming(false)} disabled={booking}>{copy.cancel}</Button>
                        <Button onClick={book} loading={booking} className="bg-orange-500 hover:bg-orange-600">
                            {copy.confirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
