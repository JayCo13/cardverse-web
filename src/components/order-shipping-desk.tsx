'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { parcelFor, parseParcel, parcelCopy, parcelPresetLabels, parcelPresetOr, PARCEL_PRESET_CODES, type Parcel, type ParcelOverrides, type ParcelPreset } from '@/lib/parcel';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { compensationFor, khaiGiaSurcharge } from '@/lib/khai-gia';
import { AlertCircle, ArrowRight, Check, Loader2, MapPin, Package, PencilLine, Save, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { PackingVideoField } from '@/components/packing-video-field';
import { GoshipRegionPicker, type GoshipRegion } from '@/components/goship-region-picker';
import { carrierAddressOptions } from '@/lib/carrier-address-options';
import { carrierShortLabels, getCarrier } from '@/lib/shipping-carriers';

/**
 * Where a seller turns one paid order into a real waybill.
 *
 * A panel on the order page rather than a dialog over a list, because booking
 * is not a quick confirmation — it dispatches a courier to the seller's door,
 * bills their GoShip account, and prints an address a stranger will drive to.
 * A dialog invites a glance; the three steps below ask to be read: check who
 * this is going between, say what is in the parcel, then choose who carries it.
 *
 * The buyer already chose the carrier and paid GoShip's price for it, so step
 * three is not a menu: it is that carrier, locked, at that price — and a list
 * of backups only when GoShip no longer offers it on the route. What the
 * seller decides here is what is THEIR cost: whether to declare a value (off
 * by default; the buyer is covered by escrow, the declaration covers the
 * seller), and whether to pack bigger than the parcel the buyer was quoted
 * for. Both are priced live and shown as one line: what they will receive.
 *
 * Rates are re-quoted whenever the parcel or declared value changes, and
 * again on open, because GoShip's rate ids expire and the price shown has to
 * be the price booked.
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
        parcel: 'Loại hàng', parcelUpgrade: 'Gói hàng lớn hơn kích thước đã báo giá: +{fee} sẽ trừ vào tiền bạn nhận.', parcelSmaller: 'Gói hàng nhỏ hơn kích thước đã báo giá — bạn không bị trừ thêm phí.',
        saveParcel: 'Lưu kích thước làm mặc định', savedParcel: 'Đã lưu kích thước mặc định cho loại hàng này.', resetParcel: 'Dùng kích thước ban đầu',
        declareToggle: 'Bảo hiểm hàng hóa (không bắt buộc)', declareOffHint: 'Bật nếu bạn muốn mua thêm quyền lợi bồi thường từ hãng khi kiện hàng bị mất hoặc hư hỏng. Phí phát sinh sẽ hiển thị rõ bên dưới và trừ vào tiền bạn nhận.',
        declared: 'Giá trị khai (đ)', declareCost: 'Phí khai giá {carrier}: +{fee} · trừ vào tiền đơn', declarePolicy: 'Mức đền theo chính sách của hãng.',
        payoutIfLost: 'Nếu mất hàng, {carrier} đền:', proofInvoice: 'có hóa đơn VAT / hóa đơn bán hàng', proofTransaction: 'có ảnh đơn CardVerseHub + biên lai chuyển khoản', proofNone: 'không có chứng từ', proofUndeclared: 'không khai giá', notAccepted: 'không chấp nhận', policyChecked: 'Theo chính sách công bố của hãng, kiểm tra {date}.',
        buyerCarrier: 'Người mua đã chọn', lockedNote: 'Người mua đã trả đúng cước này. Không trừ gì thêm.',
        carrierGone: '{carrier} hiện không nhận tuyến này. Chọn hãng khác bên dưới — người mua sẽ được thông báo, phí ship họ đã trả không đổi và phần lệch cước không trừ vào bạn.',
        payoutTitle: 'Bạn nhận được', payoutItem: 'Tiền hàng', payoutKhaiGia: 'Khai giá', payoutUpgrade: 'Gói to hơn', payoutListing: 'Cước vượt phí ship bạn đặt cho bài đăng', payoutNet: 'Thực nhận',
        pickRegion: 'Đơn này chưa có địa giới theo đơn vị vận chuyển. Chọn theo địa chỉ người nhận bên trên:',
        buyerPaid: 'Người mua đã trả', overBudget: 'trừ vào tiền đơn', inBudget: 'trong phí đã thu',
        excessNote: 'Phần cước vượt {gap} sẽ trừ vào tiền đơn hàng của bạn khi giải ngân.',
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
        parcel: 'Item type', parcelUpgrade: 'This parcel is larger than quoted: +{fee} will be deducted from your payout.', parcelSmaller: 'This parcel is smaller than quoted — no extra charge is deducted.',
        saveParcel: 'Save as default size', savedParcel: 'Default size saved for this item type.', resetParcel: 'Use original size',
        declareToggle: 'Parcel insurance (optional)', declareOffHint: 'Turn this on if you want additional carrier compensation if the parcel is lost or damaged. The fee is shown below and deducted from your payout.',
        declared: 'Declared value (đ)', declareCost: '{carrier} declaration fee: +{fee} · off your payout', declarePolicy: 'Payout per the carrier’s policy.',
        payoutIfLost: 'If the parcel is lost, {carrier} pays:', proofInvoice: 'with a VAT / sales invoice', proofTransaction: 'with the CardVerseHub order + bank receipt', proofNone: 'with no proof', proofUndeclared: 'undeclared', notAccepted: 'not accepted', policyChecked: 'Per the carrier’s published policy, checked {date}.',
        buyerCarrier: 'Buyer’s pick', lockedNote: 'The buyer paid exactly this postage. Nothing more is deducted.',
        carrierGone: '{carrier} no longer serves this route. Pick another below — the buyer is told, what they paid does not change, and the postage difference is not yours.',
        payoutTitle: 'You receive', payoutItem: 'Item price', payoutKhaiGia: 'Declared value', payoutUpgrade: 'Bigger parcel', payoutListing: 'Postage over the fee you set on the listing', payoutNet: 'Net payout',
        pickRegion: 'This order has no carrier divisions yet. Pick them from the recipient address above:',
        buyerPaid: 'Buyer paid', overBudget: 'deducted from your payout', inBudget: 'within the fee collected',
        excessNote: 'The {gap} above the shipping fee is deducted from your payout for this order.',
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
        parcel: '商品の種類', parcelUpgrade: '見積り時より大きい荷物です。+{fee} が売上から差し引かれます。', parcelSmaller: '見積り時より小さい荷物です。追加の差し引きはありません。',
        saveParcel: '既定サイズとして保存', savedParcel: 'この商品種類の既定サイズを保存しました。', resetParcel: '元のサイズを使用',
        declareToggle: '荷物保険（任意）', declareOffHint: '紛失や破損の際に配送業者から追加補償を受けたい場合はオンにしてください。料金は下に表示され、売上から差し引かれます。',
        declared: '申告価格（đ）', declareCost: '{carrier} 申告手数料: +{fee} · 売上から差引', declarePolicy: '業者の規定に従って補償。',
        payoutIfLost: '紛失時に {carrier} が支払う額:', proofInvoice: 'VAT／販売請求書あり', proofTransaction: 'CardVerseHub注文＋振込明細あり', proofNone: '証明なし', proofUndeclared: '申告なし', notAccepted: '不可', policyChecked: '業者の公開規定に基づく（{date}確認）。',
        buyerCarrier: '購入者の選択', lockedNote: '購入者はこの送料を支払済みです。追加の差引はありません。',
        carrierGone: '{carrier} はこの経路に対応していません。下から別の業者を選んでください。購入者に通知され、支払額は変わらず、差額はあなたの負担になりません。',
        payoutTitle: '受取額', payoutItem: '商品代金', payoutKhaiGia: '申告価格', payoutUpgrade: '大きい荷物', payoutListing: '出品で設定した送料を超える分', payoutNet: '実受取額',
        pickRegion: 'この注文には配送業者の行政区分がありません。上の受取人住所に合わせて選んでください：',
        buyerPaid: '購入者支払い', overBudget: '売上から差引', inBudget: '送料の範囲内',
        excessNote: '送料を超える {gap} は、この注文の支払い額から差し引かれます。',
        loading: '料金を取得中...', none: 'この経路に対応する業者がありません。',
        success: '配達成功', chosen: '選択中',
        book: '送り状を作成', booking: '作成中...', pickFirst: '配送業者を選択してください',
        confirmTitle: '送り状を作成しますか？',
        confirmBody: '{carrier} で送り状を作成します（{fee}）。集荷に伺うか、コードで窓口へ持ち込めます。',
        confirm: '作成する', cancel: 'キャンセル',
        failed: '作成できませんでした。', noPickup: '先に販売ページで集荷先を保存してください。',
    },
} as const;

const fetchOptions = carrierAddressOptions;

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/**
 * Keep the previous state object when a refetch brings back the same values.
 *
 * The preparation is re-read on every window focus, and the quote effect keys
 * on the pickup and region objects. A fresh object with identical contents
 * used to count as a change, so tabbing back to the page threw the rate list
 * away and fetched it again — the "flicker" a seller saw mid-choice.
 */
const same = <T,>(prev: T, next: T): T =>
    JSON.stringify(prev) === JSON.stringify(next) ? prev : next;

export function OrderShippingDesk({
    productKind = 'card',
    orderId,
    destination,
    defaultDeclaredValue,
    buyerPaidShipping,
    buyerCarrier,
    orderParcelPreset,
    listingOverride = false,
    recipient,
    itemName,
    onBooked,
}: {
    productKind?: string;
    orderId: string;
    /** The order's to_goship. Null means it predates the carrier ids. */
    destination: GoshipRegion | null;
    /** The sale amount — what the seller is paid before their shipping choices. */
    defaultDeclaredValue: number;
    /** What the buyer already paid for shipping on this order. */
    buyerPaidShipping: number;
    /** The carrier the buyer picked at checkout; null on orders from before that. */
    buyerCarrier: string | null;
    /** The parcel preset the buyer was quoted for; null falls to the shop default. */
    orderParcelPreset: string | null;
    /** The seller priced this listing themselves (free shipping included). */
    listingOverride?: boolean;
    recipient: { name: string; phone: string; address: string };
    itemName: string;
    onBooked: (gcode: string) => void;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    // The kind the buyer was quoted as, then the listing's own kind; the
    // seller may say it is something else and the numbers follow.
    const orderKind = parcelPresetOr(orderParcelPreset, parcelPresetOr(productKind));
    const [kind, setKind] = useState<ParcelPreset>(orderKind);
    const [overrides, setOverrides] = useState<ParcelOverrides>({});
    const toFields = (p: Parcel) => ({ weight: String(p.weight), width: String(p.width), height: String(p.height), length: String(p.length) });
    const [fields, setFields] = useState(() => toFields(parcelFor(orderKind)));
    const weight = fields.weight;
    const dimensions = useMemo(() => ({ width: fields.width, height: fields.height, length: fields.length }), [fields.width, fields.height, fields.length]);
    const [savingParcel, setSavingParcel] = useState(false);
    const [savedParcel, setSavedParcel] = useState(false);
    const parcelText = parcelCopy(locale);
    const presetLabels = parcelPresetLabels(locale);
    const parcelValid = parseParcel({ weight, ...dimensions }, true);

    // Choosing a kind refills the numbers: the seller's own for that kind if
    // they saved some, else the researched default.
    const pickKind = (next: ParcelPreset, saved: ParcelOverrides = overrides) => {
        setKind(next);
        setFields(toFields(parcelFor(next, 1, saved)));
        setSavedParcel(false);
    };

    const saveParcel = async () => {
        if (!parcelValid) return;
        setSavingParcel(true);
        try {
            const res = await fetch('/api/shipping/shop-shipping', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parcelOverrides: { [kind]: parcelValid } }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.error || copy.failed);
            setOverrides(body?.data?.parcelOverrides ?? { ...overrides, [kind]: parcelValid });
            setSavedParcel(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : copy.failed);
        } finally {
            setSavingParcel(false);
        }
    };
    const quoteRequest = useRef(0);
    // Off by default. Declaring is the seller's insurance and the seller's
    // cost; the buyer is made whole by escrow either way.
    const [declareOn, setDeclareOn] = useState(false);
    // Digits only; shown with thousand separators. Prefilled with the sale
    // amount — what the seller would want back if the parcel were lost — and
    // re-filled with it each time the switch is turned on, so an edit from an
    // earlier look does not linger.
    const orderAmountDigits = String(Math.max(0, Math.round(defaultDeclaredValue)));
    const [declared, setDeclared] = useState(orderAmountDigits);
    const declaredValue = declareOn ? Number(declared) || 0 : 0;
    const toggleDeclare = (on: boolean) => {
        setDeclareOn(on);
        if (on) setDeclared(orderAmountDigits);
    };
    const declaredDisplay = declared ? Number(declared).toLocaleString('vi-VN') : '';
    const [rates, setRates] = useState<Rate[] | null>(null);
    const [baseline, setBaseline] = useState<Rate[] | null>(null);
    const [original, setOriginal] = useState<Rate[] | null>(null);
    const [chosen, setChosen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [booking, setBooking] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Evidence: dispute_evidence_verdict reads it as the seller's side.
    const [packingVideo, setPackingVideo] = useState<string | null>(null);
    const [pickedRegion, setPickedRegion] = useState<GoshipRegion | null>(null);
    const [savedRegion, setSavedRegion] = useState<GoshipRegion | null>(destination);
    const region = savedRegion;
    const [carriers, setCarriers] = useState<string[]>([]);
    const [preparationError, setPreparationError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [preferredCarrier, setPreferredCarrier] = useState<string | null>(null);
    const words = locale === 'vi-VN'
        ? { heading: 'Chuẩn bị gửi hàng', sender: 'Lấy hàng tại', recipient: 'Giao đến', retry: 'Thử lại', missing: 'Cần bổ sung khu vực giao hàng cho đơn này.', save: 'Lưu khu vực giao đến', carriers: 'Hãng đã bật tại shop', loadError: 'Chưa tải được cấu hình gửi hàng.', declared: 'Giá trị hàng hóa. Cước bên dưới bao gồm phí khai giá của hãng.', unserved: 'Hãng không nhận tuyến này' }
        : locale === 'ja-JP'
        ? { heading: '発送の準備', sender: '集荷先', recipient: '配送先', retry: '再試行', missing: 'この注文の配送地域を補完してください。', save: '配送地域を保存', carriers: 'ショップの配送業者', loadError: '発送設定を取得できませんでした。', declared: '商品の価値。以下の送料には業者の申告手数料が含まれます。', unserved: 'この経路に対応していない業者' }
        : { heading: 'Prepare shipment', sender: 'Pickup from', recipient: 'Deliver to', retry: 'Retry', missing: 'Complete the delivery region for this order.', save: 'Save delivery region', carriers: 'Shop carriers', loadError: 'Could not load shipping settings.', declared: 'Item value. Rates below include the carrier’s declared-value fee.', unserved: 'Not serving this route' };
    const saveRegion = async () => {
        if (!pickedRegion) return;
        try {
            const response = await fetch(`/api/shipping/preparation?orderId=${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pickedRegion) });
            if (!response.ok) { setError(copy.failed); setRefresh(v => v + 1); return; }
            setSavedRegion(pickedRegion); setError(null);
        } catch { setError(copy.failed); }
    };
    // Re-read the preparation when the seller comes back from another tab —
    // /sell, most likely, where the pickup address and carriers live. Nothing
    // is cleared here: if what comes back is unchanged, the rates stay put.
    useEffect(() => {
        const reload = () => setRefresh(v => v + 1);
        window.addEventListener('focus', reload);
        return () => window.removeEventListener('focus', reload);
    }, []);

    // The sender half of the reconciliation. Stored as GoShip ids, so the names
    // have to be looked up — an id tells the seller nothing about whether the
    // courier is coming to the right place.
    const [pickup, setPickup] = useState<Pickup | null | 'missing'>(null);
    const [pickupPlace, setPickupPlace] = useState<string>('');

    useEffect(() => {
        let off = false;
        (async () => {
            try {
                setPreparationError(false);
                const res = await fetch(`/api/shipping/preparation?orderId=${orderId}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('preparation_failed');
                const body = await res.json();
                const p = body?.data?.pickup as Pickup | null;
                if (off) return;
                setCarriers(prev => same(prev, body.data.carriers as string[]));
                setSavedRegion(prev => same(prev, body.data.order.to_goship as GoshipRegion | null));
                setPreferredCarrier(body.data.order.metadata?.shipping_carrier ?? null);
                // The seller's saved parcel numbers, applied to the kind on
                // screen only the first time — a refetch on window focus must
                // not overwrite what they are typing.
                const saved = (body.data.parcelOverrides ?? {}) as ParcelOverrides;
                setOverrides(prev => {
                    if (Object.keys(prev).length === 0 && saved[orderKind]) setFields(toFields(parcelFor(orderKind, 1, saved)));
                    return same(prev, saved);
                });
                if (!p) { setPickup('missing'); return; }
                setPickup(prev => same(prev, p));
                const [cities, districts, wards] = await Promise.all([
                    fetchOptions('/api/shipping/address/cities'),
                    fetchOptions(`/api/shipping/address/districts?city_code=${encodeURIComponent(p.city)}`),
                    fetchOptions(`/api/shipping/address/wards?district_code=${encodeURIComponent(p.district)}`),
                ]).catch(() => [[], [], []]);
                if (off) return;
                setPickupPlace([
                    p.street,
                    wards.find((w) => String(w.code) === String(p.ward))?.name,
                    districts.find((d) => String(d.code) === String(p.district))?.name,
                    cities.find((c) => String(c.code) === String(p.city))?.name,
                ].filter(Boolean).join(', '));
            } catch {
                if (!off) setPreparationError(true);
            }
        })();
        return () => { off = true; };
    }, [orderId, refresh, orderKind]);

    const quote = useCallback(async () => {
        const requestId = ++quoteRequest.current;
        const parcelBody = { weight: Number(weight), ...dimensions };
        if (!region || !pickup || pickup === 'missing' || preparationError || !parseParcel(parcelBody, true)) { setRates(null); setChosen(null); setBusy(false); return; }
        // The old list stays on screen while the new one loads. Rate ids are
        // replaced when it lands; the seller's carrier choice carries over.
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/shipping/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId,
                    to: region,
                    ...parcelBody,
                    // Priced with the declared value the seller chose (0 when
                    // off); the route also answers with the same parcel at 0
                    // so the declaration's own cost can be shown.
                    declaredValue,
                }),
            });
            const body = await res.json();
            if (requestId !== quoteRequest.current) return;
            if (!res.ok) {
                setError(body.code === 'missing_goship_pickup' ? copy.noPickup : (body.error || copy.failed));
                return;
            }
            const next: Rate[] = body.data ?? [];
            setRates(next);
            setBaseline(body.baseline ?? next);
            setOriginal(body.original ?? null);
            // The buyer's carrier, when GoShip still offers it; otherwise what
            // the seller had picked among the backups; otherwise the cheapest.
            setChosen(prev => {
                const kept = prev ? rates?.find(r => r.id === prev)?.carrierCode : null;
                return next.find(r => r.carrierCode === buyerCarrier)?.id
                    ?? next.find(r => r.carrierCode === kept)?.id
                    ?? next.find(r => r.carrierCode === preferredCarrier)?.id
                    ?? next[0]?.id
                    ?? null;
            });
        } catch {
            setError(copy.failed);
        } finally {
            if (requestId === quoteRequest.current) setBusy(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rates` is read only to carry the chosen carrier over; keying on it would re-quote after every quote
    }, [region, pickup, preparationError, orderId, preferredCarrier, buyerCarrier, weight, dimensions, declaredValue, copy.noPickup, copy.failed]);

    useEffect(() => {
        setConfirming(false);
        const timer = setTimeout(() => void quote(), 400);
        return () => { clearTimeout(timer); ++quoteRequest.current; };
    }, [quote]);

    const selected = useMemo(() => rates?.find((r) => r.id === chosen) ?? null, [rates, chosen]);
    const unserved = useMemo(
        () => (rates && rates.length > 0 ? carriers.filter(code => !rates.some(r => r.carrierCode === code)) : []),
        [rates, carriers],
    );
    // The buyer's carrier is gone from the route when GoShip answered and did
    // not name it. Before the answer, nothing is known.
    const buyerCarrierGone = !!buyerCarrier && !!rates && rates.length >= 0 && !busy && !rates.some(r => r.carrierCode === buyerCarrier);

    /**
     * What this booking costs the seller, per carrier, from GoShip's own
     * answers: the declaration is the gap between the chosen quote and the
     * same parcel at 0; the upgrade is the gap between that and the parcel the
     * buyer paid for; a seller-priced listing owes whatever postage exceeds
     * the fee they set. Mirrors /api/shipping/book, which recomputes it.
     */
    const chargeFor = (r: Rate) => {
        const base = baseline?.find(b => b.carrierCode === r.carrierCode)?.totalFee
            ?? (declaredValue > 0 ? Math.max(0, r.totalFee - khaiGiaSurcharge(r.carrierCode, declaredValue)) : r.totalFee);
        const khaiGia = Math.max(0, r.totalFee - base);
        const orig = original?.find(o => o.carrierCode === r.carrierCode)?.totalFee ?? null;
        const upgrade = orig !== null ? Math.max(0, base - orig) : 0;
        const listing = listingOverride ? Math.max(0, base - upgrade - buyerPaidShipping) : 0;
        return { khaiGia, upgrade, listing, total: khaiGia + upgrade + listing };
    };
    const selectedCharge = selected ? chargeFor(selected) : null;
    const netPayout = Math.max(0, defaultDeclaredValue - (selectedCharge?.total ?? 0));
    const compensation = selected ? compensationFor(selected.carrierCode, declaredValue, selectedCharge ? selected.totalFee - selectedCharge.khaiGia : selected.totalFee) : null;

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
                    parcelKind: kind,
                    weight: Number(weight), ...dimensions,
                    declaredValue,
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
                    <Truck className="h-5 w-5 text-orange-400" />{words.heading}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.lead}</p>
                <p className="mt-2 text-sm">{words.carriers}: {carrierShortLabels(carriers) || '—'}</p>
                {preparationError && <div role="alert" className="mt-2 text-sm text-destructive">{words.loadError} <Button variant="outline" onClick={() => setRefresh(v => v + 1)}>{words.retry}</Button></div>}
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
                                    <Package className="h-3.5 w-3.5" />{words.sender}
                                </p>
                                {pickup === 'missing' ? (
                                    <p className="text-sm text-amber-300">{copy.senderMissing}</p>
                                ) : pickup === null && !preparationError ? (
                                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />…
                                    </p>
                                ) : pickup ? (
                                    <>
                                        <p className="text-sm font-medium">{pickup.name}</p>
                                        <p className="text-sm">{pickup.phone}</p>
                                        <p className="text-sm text-muted-foreground">{pickupPlace || pickup.street}</p>
                                    </>
                                ) : null}
                                <Link href="/sell#shop-shipping" className="mt-2 inline-flex items-center gap-1 text-xs text-orange-400 hover:underline">
                                    <PencilLine className="h-3 w-3" />{copy.editSender}
                                </Link>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <MapPin className="h-3.5 w-3.5" />{words.recipient}
                                </p>
                                <p className="text-sm font-medium">{recipient.name}</p>
                                <p className="text-sm">{recipient.phone}</p>
                                <p className="text-sm text-muted-foreground">{recipient.address}</p>
                                <p className="mt-2 text-xs text-muted-foreground/70">{copy.fromOrder}</p>
                                {!region && !preparationError && <div className="mt-3 space-y-3">
                                    <p className="text-sm text-amber-400">{words.missing}</p>
                                    <GoshipRegionPicker idPrefix={`osd-${orderId}`} onChange={setPickedRegion} />
                                    <Button disabled={!pickedRegion} onClick={saveRegion}>{words.save}</Button>
                                </div>}
                            </div>
                        </div>
                        <p className="text-sm">
                            <span className="text-muted-foreground">{copy.item}: </span>
                            <span className="font-medium">{itemName}</span>
                        </p>
                    </div>

                    <div className="space-y-4">
                        {stepLabel(2, copy.step2)}
                        {/* What is being sent, as the carrier bills it: the kind
                            picks the numbers, the numbers stay editable, and a
                            seller who always packs the same way saves them once. */}
                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            <div className="space-y-1.5">
                                <Label htmlFor="osd-kind">{copy.parcel}</Label>
                                <Select value={kind} onValueChange={(v) => pickKind(v as ParcelPreset)}>
                                    <SelectTrigger id="osd-kind" className="w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {PARCEL_PRESET_CODES.map(code => <SelectItem key={code} value={code}>{presetLabels[code]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="osd-weight">{copy.weight}</Label>
                                <Input id="osd-weight" value={weight} inputMode="numeric"
                                    onChange={(e) => { setFields(f => ({ ...f, weight: e.target.value.replace(/\D/g, '').slice(0, 5) })); setSavedParcel(false); }} />
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {(['width', 'height', 'length'] as const).map(key => (
                                <label className="space-y-1.5 text-sm" key={key}>
                                    <span>{parcelText[key]}</span>
                                    <Input type="number" min={1} max={200} required disabled={booking} value={fields[key]}
                                        onChange={e => { setFields(f => ({ ...f, [key]: e.target.value })); setSavedParcel(false); }} />
                                </label>
                            ))}
                        </div>
                        {!parcelValid && <p className="text-sm text-amber-400">{parcelText.invalid}</p>}
                        <div className="space-y-3">
                            {(savedParcel || (selectedCharge && selectedCharge.upgrade > 0) || (original && selected && !selectedCharge?.upgrade && JSON.stringify(parcelValid) !== JSON.stringify(parcelFor(orderKind, 1, overrides))) || kind !== orderKind) && (
                                <p className={`text-sm ${savedParcel ? 'text-green-400' : 'text-muted-foreground'}`}>
                                    {savedParcel
                                        ? copy.savedParcel
                                        : selectedCharge && selectedCharge.upgrade > 0
                                            ? copy.parcelUpgrade.replace('{fee}', money(selectedCharge.upgrade))
                                            : original && selected && !selectedCharge?.upgrade && JSON.stringify(parcelValid) !== JSON.stringify(parcelFor(orderKind, 1, overrides))
                                                ? copy.parcelSmaller
                                                : parcelText.hint}
                                </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                                <Button type="button" variant="outline" onClick={saveParcel} disabled={savingParcel || !parcelValid || savedParcel} className="h-10 w-full border-orange-500/50 px-4 font-medium text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 sm:w-auto">
                                    {savingParcel ? null : <Save className="mr-2 h-4 w-4" />}
                                    {copy.saveParcel}
                                </Button>
                                {overrides[kind] && (
                                    <Button type="button" variant="ghost" size="sm" onClick={() => { setFields(toFields(parcelFor(kind))); setSavedParcel(false); }}>
                                        {copy.resetParcel}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* The seller's insurance, and the seller's cost. Off until
                            they say otherwise: the buyer is covered by escrow, and a
                            premium on a card the carrier will settle at a fraction of
                            its value is a decision worth seeing the terms of. */}
                        <div className="space-y-2.5 rounded-lg border border-border/60 bg-background/40 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="osd-declare" className="text-sm font-medium">{copy.declareToggle}</Label>
                                <Switch id="osd-declare" checked={declareOn} onCheckedChange={toggleDeclare} />
                            </div>
                            {declareOn ? (
                                <div className="space-y-1.5">
                                    <Label htmlFor="osd-declared" className="text-xs text-muted-foreground">{copy.declared}</Label>
                                    <Input id="osd-declared" value={declaredDisplay} inputMode="numeric" className="sm:max-w-xs"
                                        onChange={(e) => setDeclared(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                                    {selected && selectedCharge && (
                                        <div className="space-y-1 text-xs">
                                            <p className="text-amber-300">
                                                {copy.declareCost.replace('{carrier}', getCarrier(selected.carrierCode)?.short ?? selected.carrierName).replace('{fee}', money(selectedCharge.khaiGia))}
                                            </p>
                                            {compensation ? (
                                                <div className="rounded-md border border-border/60 bg-background/40 p-2.5 text-muted-foreground">
                                                    <p className="font-medium text-foreground">{copy.payoutIfLost.replace('{carrier}', getCarrier(selected.carrierCode)?.short ?? selected.carrierName)}</p>
                                                    <ul className="mt-1 space-y-0.5">
                                                        <li className="flex justify-between gap-3"><span>{copy.proofInvoice}</span><span className="font-semibold text-foreground">{compensation.invoice === null ? copy.notAccepted : money(compensation.invoice)}</span></li>
                                                        <li className="flex justify-between gap-3"><span>{copy.proofTransaction}</span><span className="font-semibold text-foreground">{compensation.transaction === null ? copy.notAccepted : money(compensation.transaction)}</span></li>
                                                        <li className="flex justify-between gap-3"><span>{copy.proofNone}</span><span className="font-semibold text-foreground">{compensation.noProof === null ? '—' : money(compensation.noProof)}</span></li>
                                                        <li className="flex justify-between gap-3"><span>{copy.proofUndeclared}</span><span>{compensation.undeclared === null ? '—' : money(compensation.undeclared)}</span></li>
                                                    </ul>
                                                    <p className="mt-1 text-[11px]">{copy.policyChecked.replace('{date}', '12/09/2026')}</p>
                                                </div>
                                            ) : (
                                                <p className="text-muted-foreground">{copy.declarePolicy}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm leading-5 text-muted-foreground">{copy.declareOffHint}</p>
                            )}
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
                                    <p className="text-sm text-muted-foreground">{words.missing}</p>
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

                                    {buyerCarrierGone && rates && (
                                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-200">
                                            {copy.carrierGone.replace('{carrier}', getCarrier(buyerCarrier!)?.short ?? buyerCarrier!.toUpperCase())}
                                        </p>
                                    )}

                                    {/* GoShip quotes only the carriers that serve a route —
                                        SPX, for one, returns nothing out of Cà Mau — so a
                                        carrier the shop enabled can be missing here through
                                        no fault of the seller's. Say so, or the list reads
                                        as a bug. */}
                                    {unserved.length > 0 && !buyerCarrierGone && (
                                        <p className="text-xs text-muted-foreground">{words.unserved}: {carrierShortLabels(unserved)}</p>
                                    )}

                                    {rates && rates.length > 0 && (
                                        // The buyer's carrier alone while GoShip still offers
                                        // it — they chose and paid for it. The full list only
                                        // when it is gone and a backup has to be picked.
                                        <ul className="space-y-2">
                                            {rates.filter(r => buyerCarrierGone || !buyerCarrier || r.carrierCode === buyerCarrier).map((r) => {
                                                const isChosen = r.id === chosen;
                                                const locked = !!buyerCarrier && r.carrierCode === buyerCarrier;
                                                const charge = chargeFor(r);
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
                                                                {locked && (
                                                                    <span className="shrink-0 rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-[11px] font-medium text-blue-300">{copy.buyerCarrier}</span>
                                                                )}
                                                                <span className="shrink-0 font-semibold text-orange-400">{money(r.totalFee)}</span>
                                                            </span>
                                                            <span className="mt-1 flex items-center justify-between gap-2 pl-6">
                                                                <span className="min-w-0 truncate text-xs text-muted-foreground">
                                                                    {[r.service, r.expected,
                                                                      r.successPercent != null ? `${r.successPercent}% ${copy.success}` : null]
                                                                        .filter(Boolean).join(' · ')}
                                                                </span>
                                                                {/* Only what the seller chose is theirs: the declaration,
                                                                    a bigger parcel, or postage over a fee they set on the
                                                                    listing. Postage drift on the buyer's own carrier, or on
                                                                    a backup, is not. */}
                                                                <span className={`shrink-0 text-xs ${charge.total > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                                                    {charge.total > 0
                                                                        ? `${copy.overBudget} ${money(charge.total)}`
                                                                        : copy.inBudget}
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
                                    <Button variant="outline" size="sm" onClick={quote}>{words.retry}</Button>
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
                            {selected && selectedCharge && (
                                <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.payoutTitle}</p>
                                    <div className="flex justify-between"><span className="text-muted-foreground">{copy.payoutItem}</span><span>{money(defaultDeclaredValue)}</span></div>
                                    {selectedCharge.khaiGia > 0 && <div className="flex justify-between text-amber-300"><span>{copy.payoutKhaiGia}</span><span>−{money(selectedCharge.khaiGia)}</span></div>}
                                    {selectedCharge.upgrade > 0 && <div className="flex justify-between text-amber-300"><span>{copy.payoutUpgrade}</span><span>−{money(selectedCharge.upgrade)}</span></div>}
                                    {selectedCharge.listing > 0 && <div className="flex justify-between text-amber-300"><span>{copy.payoutListing}</span><span>−{money(selectedCharge.listing)}</span></div>}
                                    {selectedCharge.total === 0 && <p className="text-xs text-muted-foreground">{copy.lockedNote}</p>}
                                    <div className="flex justify-between border-t border-border/60 pt-1.5 font-semibold"><span>{copy.payoutNet}</span><span className="text-orange-400">{money(netPayout)}</span></div>
                                </div>
                            )}
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
