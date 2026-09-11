'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, Save, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { useToast } from '@/hooks/use-toast';
import { carrierServesTier, SHIPPING_CARRIERS } from '@/lib/shipping-carriers';
import { khaiGiaModel, khaiGiaSurcharge } from '@/lib/khai-gia';
import {
    LISTING_SHIPPING_FEE_MAX,
    type ShippingTier,
    type ShopFeeTable as FeeTable,
} from '@/lib/shipping-fee';

/**
 * The shop's postage price list: three boxes per carrier, each with the real
 * GoShip price behind it.
 *
 * The recommendation is a placeholder rather than a prefilled value, and that
 * distinction is the whole design. A box the seller leaves empty keeps
 * following the quote as carrier prices move; a box they type into is theirs
 * and stops moving. Prefilling would silently convert every seller into the
 * second kind on their first save.
 *
 * Khai giá is deliberately NOT a box. GHN, BEST and J&T charge a percentage of
 * the card's value with no ceiling, so any number a seller typed would be right
 * for one card and short for the next dearer one. It is added at checkout from
 * the measured model instead, and shown here so nobody is surprised by it.
 *
 * Nothing is marked up. What a buyer pays above what the parcel costs already
 * stays with the platform — seller_payout_for nets the excess and does not
 * refund the surplus — so adding a margin on top of the suggestion would be
 * charging for the same thing twice.
 */

const TIERS: ShippingTier[] = ['intra', 'inter', 'region'];

/** The card values the khai giá examples are worked at. */
const EXAMPLE_VALUE = 5_000_000;
const EXAMPLE_HIGH_VALUE = 20_000_000;

type Loaded = {
    carriers: string[];
    fees: FeeTable;
    recommended: FeeTable;
    recommendedAt: string | null;
    hasPickup: boolean;
};

/** Boxes hold what was typed, so a half-finished number is never a price. */
type Draft = Record<string, Record<string, string>>;

const toDraft = (fees: FeeTable): Draft => {
    const draft: Draft = {};
    Object.entries(fees).forEach(([carrier, tiers]) => {
        draft[carrier] = {};
        Object.entries(tiers ?? {}).forEach(([tier, fee]) => {
            draft[carrier][tier] = String(fee);
        });
    });
    return draft;
};

/** Empty boxes drop out entirely; the server reads that as "use the quote". */
const fromDraft = (draft: Draft): FeeTable => {
    const fees: FeeTable = {};
    Object.entries(draft).forEach(([carrier, tiers]) => {
        const row: FeeTable[string] = {};
        Object.entries(tiers).forEach(([tier, raw]) => {
            const digits = raw.replace(/[^0-9]/g, '');
            if (digits === '') return;
            row[tier as ShippingTier] = Number(digits);
        });
        if (Object.keys(row).length) fees[carrier] = row;
    });
    return fees;
};

export function ShopFeeTable() {
    const { locale } = useLocalization();
    const { toast } = useToast();
    const tx = (vi: string, en: string, ja: string) =>
        (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);
    const fmt = (n: number) => new Intl.NumberFormat(locale).format(n) + 'đ';
    const pct = (rate: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate * 100) + '%';

    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [carriers, setCarriers] = useState<string[]>([]);
    const [draft, setDraft] = useState<Draft>({});
    const [recommended, setRecommended] = useState<FeeTable>({});
    const [recommendedAt, setRecommendedAt] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch('/api/shipping/fee-table');
                const payload = await response.json().catch(() => null);
                if (cancelled) return;
                if (!response.ok) throw new Error(payload?.error || 'load failed');
                const data = payload.data as Loaded;
                setLoaded(data);
                setCarriers(data.carriers);
                setDraft(toDraft(data.fees));
                setRecommended(data.recommended);
                setRecommendedAt(data.recommendedAt);
            } catch {
                if (!cancelled) setLoaded({ carriers: [], fees: {}, recommended: {}, recommendedAt: null, hasPickup: false });
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const suggestion = useCallback(
        (carrier: string, tier: ShippingTier): number | null => {
            const value = recommended?.[carrier]?.[tier];
            return typeof value === 'number' ? value : null;
        },
        [recommended],
    );

    const setCell = (carrier: string, tier: string, raw: string) => {
        setDraft(current => ({
            ...current,
            [carrier]: { ...(current[carrier] ?? {}), [tier]: raw.replace(/[^0-9]/g, '') },
        }));
    };

    /** Copy today's quote into the boxes, where there is one to copy. */
    const applySuggestions = (carrier: string) => {
        setDraft(current => {
            const row: Record<string, string> = { ...(current[carrier] ?? {}) };
            TIERS.filter(tier => carrierServesTier(carrier, tier)).forEach(tier => {
                const value = suggestion(carrier, tier);
                if (value !== null) row[tier] = String(value);
            });
            return { ...current, [carrier]: row };
        });
    };

    const toggleCarrier = (code: string) => {
        setCarriers(current =>
            current.includes(code) ? current.filter(c => c !== code) : [...current, code]);
    };

    const refresh = async () => {
        setIsRefreshing(true);
        try {
            const response = await fetch('/api/shipping/fee-table', { method: 'POST' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'refresh failed');
            setRecommended(payload.data.recommended);
            setRecommendedAt(payload.data.recommendedAt);
            toast({ title: tx('Đã cập nhật giá đề xuất.', 'Suggestions updated.', '目安を更新しました。') });
        } catch (error: any) {
            toast({ variant: 'destructive', title: error.message });
        } finally {
            setIsRefreshing(false);
        }
    };

    const save = async () => {
        setIsSaving(true);
        try {
            const response = await fetch('/api/shipping/fee-table', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carriers, fees: fromDraft(draft) }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'save failed');
            toast({ title: tx('Đã lưu bảng phí.', 'Fee table saved.', '送料表を保存しました。') });
        } catch (error: any) {
            toast({ variant: 'destructive', title: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    if (!loaded) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tx('Đang tải bảng phí…', 'Loading fee table…', '送料表を読み込み中…')}
            </div>
        );
    }

    const tierLabel: Record<ShippingTier, string> = {
        intra: tx('Nội tỉnh', 'Same province', '同一省内'),
        inter: tx('Liên tỉnh', 'Same region', '同一地域'),
        region: tx('Liên miền', 'Across regions', '地域をまたぐ'),
    };

    /**
     * What this carrier adds for declared value, in one line.
     *
     * Written from the model rather than typed out per carrier, so a corrected
     * measurement changes the number the seller reads as well as the number
     * they are charged. Carriers with more than one band get a worked example
     * at the top of the range too — BEST doubling to 1% above 10,000,000đ is
     * exactly the kind of thing a seller should not discover from a payout.
     */
    const khaiGiaLine = (code: string): string => {
        const bands = khaiGiaModel(code);
        if (bands.length === 0) {
            return tx(
                'Không thu phí khai giá — thẻ 100 triệu cũng như thẻ 50 nghìn.',
                'Charges nothing for declared value — a 100M card costs the same as a 50k one.',
                '保険評価額の料金なし — 1億đのカードでも5万đのカードと同額です。',
            );
        }

        const part = (band: typeof bands[number]) => {
            const from = tx(`từ ${fmt(band.from)}`, `from ${fmt(band.from)}`, `${fmt(band.from)}以上`);
            const cost = band.rate === 0
                ? `+${fmt(band.flat)}`
                : `+${pct(band.rate)}` + (band.flat ? ` +${fmt(band.flat)}` : '');
            return `${from}: ${cost}`;
        };

        const examples = (bands.length > 1 ? [EXAMPLE_VALUE, EXAMPLE_HIGH_VALUE] : [EXAMPLE_VALUE])
            .map(value => `${fmt(value)} → +${fmt(khaiGiaSurcharge(code, value))}`)
            .join(', ');

        const rules = bands.map(part).join('; ');
        return tx(
            `Phí khai giá tự cộng — ${rules}. Ví dụ: thẻ ${examples}.`,
            `Khai giá is added automatically — ${rules}. For example: a ${examples}.`,
            `保険評価額の料金を自動加算 — ${rules}。例: ${examples}。`,
        );
    };

    return (
        <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
                {tx(
                    'Chọn đơn vị vận chuyển bạn nhận gửi, rồi đặt cước gửi người mua trả cho từng khoảng cách. Ô để trống sẽ tự dùng giá GoShip thật bên dưới và tự cập nhật khi hãng đổi giá — điền số vào là số của bạn, không đổi nữa.',
                    'Pick the carriers you ship with, then set the postage the buyer pays for each distance. An empty box follows the real GoShip price below and keeps following it; a number you type is yours and stops moving.',
                    '発送に使う業者を選び、距離ごとに買い手が払う送料を設定します。空欄なら下の実際のGoShip価格に追従し、入力した数値はそのまま固定されます。',
                )}
            </p>
            <p className="text-muted-foreground">
                {tx(
                    'Phí khai giá KHÔNG nằm trong các ô này — hệ thống tự cộng theo giá trị từng thẻ lúc thanh toán, đúng công thức của hãng. Nghĩa là bạn không bao giờ lỗ vì bán thẻ đắt, và người mua thẻ rẻ không phải gánh hộ.',
                    'Khai giá is NOT in these boxes — it is added at checkout from each card’s value, on the carrier’s own formula. So a dear card can never leave you short, and a cheap card’s buyer never subsidises one.',
                    '保険評価額の料金はこの欄に含まれません。決済時に各カードの価値から業者の計算式で自動加算されます。高額カードで赤字にならず、安価なカードの買い手が肩代わりすることもありません。',
                )}
            </p>

            <div className="flex flex-wrap gap-2">
                {SHIPPING_CARRIERS.map(carrier => {
                    const on = carriers.includes(carrier.code);
                    return (
                        <button
                            key={carrier.code}
                            type="button"
                            onClick={() => toggleCarrier(carrier.code)}
                            aria-pressed={on}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                on ? 'border-orange-500/60 bg-orange-500/10 text-foreground' : 'border-zinc-800 text-muted-foreground hover:border-zinc-700'
                            }`}
                        >
                            {carrier.logo
                                ? <img src={carrier.logo} alt="" className="h-4 w-4 rounded object-contain" />
                                : <Truck aria-hidden="true" className="h-4 w-4" />}
                            {carrier.short}
                        </button>
                    );
                })}
            </div>

            {carriers.length === 0 && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                    {tx(
                        'Chưa chọn hãng nào — người mua sẽ thấy tất cả các hãng khả dụng.',
                        'No carrier picked — buyers will see every available carrier.',
                        '業者が未選択です。買い手にはすべての業者が表示されます。',
                    )}
                </p>
            )}

            {!loaded.hasPickup && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                    {tx(
                        'Chưa có địa chỉ lấy hàng nên chưa tính được giá đề xuất. Lưu địa chỉ ở trên trước.',
                        'No pickup address yet, so nothing can be quoted. Save one above first.',
                        '集荷先住所が未設定のため見積もりできません。先に上で保存してください。',
                    )}
                </p>
            )}

            {carriers.map(code => {
                const carrier = SHIPPING_CARRIERS.find(c => c.code === code);

                // Hand delivery has no boxes because it has no price. Shown as
                // a row anyway so a seller who turned it on can see what they
                // turned on, and see that it costs nobody anything.
                if (carrier && !carrier.booksWithCarrier) {
                    return (
                        <div key={code} className="rounded-xl border border-zinc-800 bg-background/30 p-3">
                            <div className="mb-1 flex items-center gap-2">
                                <Truck aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
                                <span className="text-sm font-semibold">{carrier.name}</span>
                                <span className="ml-auto text-sm font-semibold text-green-400">
                                    {tx('Miễn phí', 'Free', '無料')}
                                </span>
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">
                                {tx(
                                    'Chỉ hiện với người mua cùng tỉnh/thành với bạn, hai bên tự hẹn địa chỉ gặp mặt. Người mua không trả phí ship và bạn cũng không bị trừ gì — khác với miễn phí vận chuyển, ở đây không có cước của hãng nào cả.',
                                    'Only shown to buyers in your own province; the two of you agree where to meet. The buyer pays no shipping and nothing is deducted from you either — unlike free shipping, there is no carrier bill at all.',
                                    '同じ省・市の買い手にのみ表示され、待ち合わせ場所は当事者間で決めます。買い手は送料を払わず、あなたからも何も差し引かれません。送料無料と違い、そもそも業者の料金が発生しません。',
                                )}
                            </p>
                        </div>
                    );
                }

                return (
                    <div key={code} className="rounded-xl border border-zinc-800 bg-background/30 p-3">
                        <div className="mb-3 flex items-center gap-2">
                            {carrier?.logo
                                ? <img src={carrier.logo} alt="" className="h-5 w-5 rounded object-contain" />
                                : <Truck aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
                            <span className="text-sm font-semibold">{carrier?.name || code}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="ml-auto h-7 text-xs"
                                onClick={() => applySuggestions(code)}
                            >
                                {tx('Dùng giá đề xuất', 'Use suggestions', '目安を使う')}
                            </Button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            {TIERS.filter(tier => carrierServesTier(code, tier)).map(tier => {
                                const hint = suggestion(code, tier);
                                return (
                                    <label key={tier} className="block">
                                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                                            {tierLabel[tier]}
                                        </span>
                                        <Input
                                            inputMode="numeric"
                                            aria-label={`${carrier?.short || code} · ${tierLabel[tier]}`}
                                            value={draft[code]?.[tier] ?? ''}
                                            onChange={event => setCell(code, tier, event.target.value)}
                                            placeholder={hint === null
                                                ? tx('Chưa có giá', 'No quote', '見積もりなし')
                                                : fmt(hint)}
                                            max={LISTING_SHIPPING_FEE_MAX}
                                            className="h-9 text-sm"
                                        />
                                    </label>
                                );
                            })}
                        </div>

                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{khaiGiaLine(code)}</p>
                    </div>
                );
            })}

            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={save} disabled={isSaving}>
                    {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                    {tx('Lưu bảng phí', 'Save fee table', '送料表を保存')}
                </Button>
                <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing || !loaded.hasPickup}>
                    {isRefreshing ? null : <RefreshCw className="mr-2 h-4 w-4" />}
                    {tx('Tính lại giá đề xuất', 'Refresh suggestions', '目安を再計算')}
                </Button>
                {recommendedAt && (
                    <span className="text-xs text-muted-foreground">
                        {tx('Giá đề xuất lúc ', 'Quoted ', '見積もり日時 ')}
                        {new Date(recommendedAt).toLocaleString(locale)}
                    </span>
                )}
            </div>
        </div>
    );
}
