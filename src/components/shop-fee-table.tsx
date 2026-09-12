'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Loader2, Save, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { useToast } from '@/hooks/use-toast';
import { carrierServesTier, getCarrier, OFFERABLE_CARRIERS } from '@/lib/shipping-carriers';
import { khaiGiaModel } from '@/lib/khai-gia';
import {
    DEFAULT_SHOP_TIER_FEES,
    isValidShopTierFee,
    SHOP_TIER_FEE_MAX,
    SHOP_TIER_FEE_MIN,
    type ShippingTier,
    type ShopFeeTable as FeeTable,
} from '@/lib/shipping-fee';

/**
 * The shop's postage price list: three boxes per carrier, each with the real
 * GoShip price behind it.
 *
 * The recommendation is a placeholder rather than a prefilled value: an empty
 * box is charged at the default and says so through the placeholder, and a box
 * the seller types into is theirs. Both end up at the same number unless the
 * seller moves one, which is the point — the suggestion and the fallback are
 * one table, DEFAULT_SHOP_TIER_FEES, not two that can drift.
 *
 * A typed number has to land between SHOP_TIER_FEE_MIN and SHOP_TIER_FEE_MAX.
 * The floor is the load-bearing half: under it the seller pays the difference
 * on every order the cell prices, and one shop really did type 11,000đ when the
 * boxes took any number at all.
 *
 * Khai giá is deliberately NOT a box. GHN and J&T charge a percentage of the
 * card's value with no ceiling, so any number a seller typed would be right
 * for one card and short for the next dearer one. It is added at checkout from
 * the measured model instead, and shown here so nobody is surprised by it.
 *
 * Nothing is marked up. What a buyer pays above what the parcel costs already
 * stays with the platform — seller_payout_for nets the excess and does not
 * refund the surplus — so adding a margin on top of the suggestion would be
 * charging for the same thing twice.
 */

const TIERS: ShippingTier[] = ['intra', 'inter', 'region'];

/** One line of the disclosure below the fields. */
const Note = ({ children }: { children: React.ReactNode }) => (
    <li className="leading-5">{children}</li>
);

type Loaded = {
    carriers: string[];
    fees: FeeTable;
    recommended: FeeTable;
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

type ShopFeeTableProps = {
    /**
     * Told after a save the server accepted, so a caller gating on "this shop
     * has shipping" can move on without re-reading the profile.
     */
    onSaved?: () => void;
    /**
     * Refuse to save until at least one carrier is on.
     *
     * Off everywhere except the listing wizard. On /sell an empty list is a
     * real answer — it means "buyers see every carrier" — and demanding a pick
     * there would break shops that are selling perfectly well today.
     */
    requireCarrier?: boolean;
};

export function ShopFeeTable({ onSaved, requireCarrier = false }: ShopFeeTableProps = {}) {
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
    const [isSaving, setIsSaving] = useState(false);

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
            } catch {
                if (!cancelled) setLoaded({ carriers: [], fees: {}, recommended: {} });
            }
        })();
        return () => { cancelled = true; };
    }, []);

    /**
     * What this cell costs when the seller leaves it alone.
     *
     * The server sends the same table, and the constant answers before it
     * arrives and if the request ever fails — a placeholder that says "Chưa có
     * giá" was the old failure mode, and it told the seller nothing about what
     * a buyer would actually be charged.
     */
    const suggestion = useCallback(
        (carrier: string, tier: ShippingTier): number => {
            const value = recommended?.[carrier]?.[tier];
            return typeof value === 'number' ? value : DEFAULT_SHOP_TIER_FEES[tier];
        },
        [recommended],
    );

    const setCell = (carrier: string, tier: string, raw: string) => {
        setDraft(current => ({
            ...current,
            [carrier]: { ...(current[carrier] ?? {}), [tier]: raw.replace(/[^0-9]/g, '') },
        }));
    };

    /** Write the default into every box of one carrier. */
    const applySuggestions = (carrier: string) => {
        setDraft(current => {
            const row: Record<string, string> = { ...(current[carrier] ?? {}) };
            TIERS.filter(tier => carrierServesTier(carrier, tier)).forEach(tier => {
                row[tier] = String(suggestion(carrier, tier));
            });
            return { ...current, [carrier]: row };
        });
    };

    const toggleCarrier = (code: string) => {
        setCarriers(current =>
            current.includes(code) ? current.filter(c => c !== code) : [...current, code]);
    };

    /**
     * Is any box holding a number the server would refuse?
     *
     * Read off the draft rather than tracked per box, so a cell that becomes
     * valid again re-enables the button without any bookkeeping.
     */
    const hasInvalidCell = Object.values(draft).some(row =>
        Object.values(row).some(raw => raw !== '' && !isValidShopTierFee(Number(raw))));

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
            onSaved?.();
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
     * What this carrier adds for declared value, in as few words as possible.
     *
     * Written from the model rather than typed out per carrier, so a corrected
     * measurement changes the number the seller reads as well as the number
     * they are charged. Every band is still listed — a carrier that changes
     * rate partway up the range is exactly what a seller should not discover
     * from a payout — but the worked examples are gone: they restated the rule
     * in longer form directly under it, and one per carrier is what buried the
     * fields this page exists for.
     */
    const khaiGiaLine = (code: string): string | null => {
        const bands = khaiGiaModel(code);
        if (bands.length === 0) return null;

        const part = (band: typeof bands[number]) => {
            const from = tx(`từ ${fmt(band.from)}`, `from ${fmt(band.from)}`, `${fmt(band.from)}以上`);
            const cost = band.rate === 0
                ? `+${fmt(band.flat)}`
                : `+${pct(band.rate)}` + (band.flat ? ` +${fmt(band.flat)}` : '');
            return `${from} ${cost}`;
        };

        const rules = bands.map(part).join(' · ');
        return tx(`Khai giá: ${rules}`, `Declared value: ${rules}`, `保険評価額: ${rules}`);
    };

    return (
        <div className="space-y-4 text-sm">
            <div className="space-y-2.5">
                <p className="text-muted-foreground">
                    {tx(
                        'Chọn hãng bạn nhận gửi. Giá mặc định đã đặt sẵn, muốn đổi thì điền số của bạn.',
                        'Pick the carriers you ship with. The default prices are already set; type your own to change one.',
                        '発送に使う業者を選びます。既定の送料が設定済みで、変更したい場合のみ入力します。',
                    )}
                </p>

                <div className="flex flex-wrap gap-2">
                    {OFFERABLE_CARRIERS.map(carrier => {
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

                {/* The rules used to be four paragraphs above the fields, and a
                    seller had to read all of them to reach the thing they came
                    to type. They are still all here, one line each, behind a
                    disclosure — closed for the seller who already knows how the
                    table works, one click away for the one who does not. */}
                <details className="group rounded-lg border border-zinc-800 bg-background/30">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                        <ChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                        {tx('Phí này tính thế nào?', 'How the fee works', '送料の仕組み')}
                    </summary>
                    <ul className="space-y-1.5 px-3 pb-3 text-xs text-muted-foreground">
                        <Note>
                            {tx(
                                `Ô trống tính theo giá mặc định: nội tỉnh ${fmt(DEFAULT_SHOP_TIER_FEES.intra)}, liên tỉnh ${fmt(DEFAULT_SHOP_TIER_FEES.inter)}, liên miền ${fmt(DEFAULT_SHOP_TIER_FEES.region)}.`,
                                `An empty box is charged at the default: ${fmt(DEFAULT_SHOP_TIER_FEES.intra)} same province, ${fmt(DEFAULT_SHOP_TIER_FEES.inter)} same region, ${fmt(DEFAULT_SHOP_TIER_FEES.region)} across regions.`,
                                `空欄は既定額: 同一省内${fmt(DEFAULT_SHOP_TIER_FEES.intra)}、同一地域${fmt(DEFAULT_SHOP_TIER_FEES.inter)}、地域をまたぐ${fmt(DEFAULT_SHOP_TIER_FEES.region)}。`,
                            )}
                        </Note>
                        <Note>
                            {tx(
                                `Muốn đổi thì điền số của bạn, trong khoảng ${fmt(SHOP_TIER_FEE_MIN)} – ${fmt(SHOP_TIER_FEE_MAX)}.`,
                                `To change one, type your own number between ${fmt(SHOP_TIER_FEE_MIN)} and ${fmt(SHOP_TIER_FEE_MAX)}.`,
                                `変更する場合は${fmt(SHOP_TIER_FEE_MIN)}〜${fmt(SHOP_TIER_FEE_MAX)}の範囲で入力してください。`,
                            )}
                        </Note>
                        <Note>
                            {tx(
                                'Phí khai giá không nằm trong các ô này — tự cộng theo giá trị từng thẻ lúc thanh toán, nên bán thẻ đắt không lỗ.',
                                'Khai giá is not in these boxes — it is added at checkout from each card’s value, so a dear card never leaves you short.',
                                '保険評価額の料金は欄に含まれず、決済時に各カードの価値から加算されます。',
                            )}
                        </Note>
                        <Note>
                            {tx(
                                'Mỗi bài đăng vẫn đặt được phí ship riêng, đè lên bảng này.',
                                'Any listing can still set its own shipping fee, overriding this table.',
                                '出品ごとに独自の送料を設定してこの表を上書きできます。',
                            )}
                        </Note>
                        <Note>
                            {tx(
                                'Người mua trả theo hãng rẻ nhất bạn bật. Cước thực tế cao hơn phí đã thu thì phần vượt trừ vào tiền bạn nhận.',
                                'The buyer pays for the cheapest carrier you enable. If the real bill exceeds the fee collected, the difference comes off your payout.',
                                '買い手は有効にした中で最も安い業者の料金を支払います。実際の料金が徴収額を超えた分は受取額から差し引かれます。',
                            )}
                        </Note>
                    </ul>
                </details>
            </div>

            {carriers.length === 0 && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                    {requireCarrier
                        ? tx(
                            'Chọn ít nhất một đơn vị vận chuyển để tiếp tục.',
                            'Pick at least one carrier to continue.',
                            '続けるには配送業者を1社以上選んでください。',
                        )
                        : tx(
                            'Chưa chọn hãng nào — người mua sẽ thấy tất cả các hãng.',
                            'No carrier picked — buyers see every carrier.',
                            '業者が未選択です。買い手には全業者が表示されます。',
                        )}
                </p>
            )}

            {carriers.map(code => {
                const carrier = getCarrier(code);
                const khaiGia = khaiGiaLine(code);

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
                                const typed = draft[code]?.[tier] ?? '';
                                // Flagged while typing rather than on save: the
                                // server refuses the same number, and finding
                                // that out after pressing Lưu means hunting for
                                // which of six boxes it meant.
                                const outOfBand = typed !== '' && !isValidShopTierFee(Number(typed));
                                return (
                                    <label key={tier} className="block">
                                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                                            {tierLabel[tier]}
                                        </span>
                                        <Input
                                            inputMode="numeric"
                                            aria-label={`${carrier?.short || code} · ${tierLabel[tier]}`}
                                            aria-invalid={outOfBand}
                                            value={typed}
                                            onChange={event => setCell(code, tier, event.target.value)}
                                            placeholder={fmt(suggestion(code, tier))}
                                            min={SHOP_TIER_FEE_MIN}
                                            max={SHOP_TIER_FEE_MAX}
                                            className={`h-9 text-sm ${outOfBand ? 'border-red-500/60 focus-visible:ring-red-500/40' : ''}`}
                                        />
                                    </label>
                                );
                            })}
                        </div>

                        {khaiGia && <p className="mt-2 text-[11px] text-muted-foreground/80">{khaiGia}</p>}
                    </div>
                );
            })}

            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={save} disabled={isSaving || hasInvalidCell || (requireCarrier && carriers.length === 0)}>
                    {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                    {tx('Lưu bảng phí', 'Save fee table', '送料表を保存')}
                </Button>
                <span className={`text-xs ${hasInvalidCell ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {tx(
                        `Phí trong khoảng ${fmt(SHOP_TIER_FEE_MIN)} – ${fmt(SHOP_TIER_FEE_MAX)}.`,
                        `Fees run ${fmt(SHOP_TIER_FEE_MIN)} – ${fmt(SHOP_TIER_FEE_MAX)}.`,
                        `送料は${fmt(SHOP_TIER_FEE_MIN)}〜${fmt(SHOP_TIER_FEE_MAX)}の範囲。`,
                    )}
                </span>
            </div>
        </div>
    );
}
