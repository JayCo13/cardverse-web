'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, Pencil, RefreshCw, Save, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { useToast } from '@/hooks/use-toast';
import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';

/**
 * The shop's shipping setup: couriers and parcel, no prices.
 *
 * Postage is GoShip's number for the buyer's route, quoted at checkout, so the
 * seller is not asked to guess it. What they are asked is the one thing GoShip
 * cannot know: which of the couriers that collect at their door they will
 * use. Couriers that do not collect at the pickup address are shown greyed
 * rather than hidden — a seller in Cà Mau should see that SPX exists and does
 * not come, not wonder where it went. The parcel is chosen per listing (and
 * again at booking); the shop default stays `raw`.
 */

type Loaded = {
    carriers: string[];
    coverage: { carriers: string[]; checked_at: string } | null;
    hasPickup: boolean;
};

type Props = {
    onSaved?: (data: Loaded) => void;
    /** Refuse to save with no carrier — the listing wizard needs one. */
    requireCarrier?: boolean;
    /** Show a compact saved-state row, like the sender-address form. */
    summaryMode?: boolean;
    /** Open the editor when arriving from a setup deep link. */
    startEditing?: boolean;
};

export function ShopShippingSetup({ onSaved, requireCarrier = false, summaryMode = false, startEditing = false }: Props = {}) {
    const { locale } = useLocalization();
    const { toast } = useToast();
    const tx = (vi: string, en: string, ja: string) =>
        (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);

    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [carriers, setCarriers] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isProbing, setIsProbing] = useState(false);
    const [editing, setEditing] = useState(startEditing || requireCarrier);

    useEffect(() => {
        if (startEditing) setEditing(true);
    }, [startEditing]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch('/api/shipping/shop-shipping', { cache: 'no-store' });
                const payload = await response.json().catch(() => null);
                if (cancelled) return;
                if (!response.ok) throw new Error(payload?.error || 'load failed');
                const data = payload.data as Loaded;
                setLoaded(data);
                setCarriers(data.carriers);
            } catch {
                if (!cancelled) setLoaded({ carriers: [], coverage: null, hasPickup: false });
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const collects = (code: string) => !loaded?.coverage?.carriers?.length || loaded.coverage.carriers.includes(code);

    const toggleCarrier = (code: string) => {
        if (!collects(code)) return;
        setCarriers(prev => (prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]));
    };

    const probe = async () => {
        setIsProbing(true);
        try {
            const response = await fetch('/api/shipping/coverage', { method: 'POST' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'probe failed');
            const coverage = payload.data as { carriers: string[]; checked_at: string };
            setLoaded(prev => (prev ? { ...prev, coverage } : prev));
            setCarriers(prev => prev.filter(c => coverage.carriers.includes(c)));
            toast({ title: tx('Đã kiểm tra đơn vị vận chuyển tại khu vực của bạn.', 'Checked which carriers collect here.', '集荷可能な業者を確認しました。') });
        } catch (error: any) {
            toast({ variant: 'destructive', title: error.message });
        } finally {
            setIsProbing(false);
        }
    };

    const save = async () => {
        setIsSaving(true);
        try {
            const response = await fetch('/api/shipping/shop-shipping', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carriers }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'save failed');
            const data = payload.data as Loaded;
            setLoaded(data);
            setCarriers(data.carriers);
            setEditing(false);
            toast({ title: tx('Đã lưu cấu hình vận chuyển.', 'Shipping setup saved.', '配送設定を保存しました。') });
            onSaved?.(data);
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
                {tx('Đang tải cấu hình vận chuyển…', 'Loading shipping setup…', '配送設定を読み込み中…')}
            </div>
        );
    }

    const checkedAt = loaded.coverage ? new Date(loaded.coverage.checked_at).toLocaleDateString(locale) : null;

    if (summaryMode && carriers.length > 0 && !editing) {
        const selected = OFFERABLE_COURIERS.filter(carrier => carriers.includes(carrier.code));
        return (
            <div className="flex flex-col gap-3 rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium">
                            {tx('Đã thiết lập vận chuyển', 'Shipping is ready', '配送設定済み')}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {selected.map((carrier) => (
                                <span key={carrier.code} className="inline-flex items-center gap-1.5">
                                    {carrier.logo
                                        ? <img src={carrier.logo} alt="" className="h-3.5 w-3.5 rounded object-contain" />
                                        : <Truck aria-hidden="true" className="h-3.5 w-3.5" />}
                                    {carrier.short}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    {tx('Chỉnh sửa', 'Edit', '編集')}
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-5 text-sm">
            <div className="space-y-2.5">
                <p className="text-muted-foreground">
                    {tx(
                        'Chọn hãng có thể đến lấy hàng. Người mua chọn hãng khi thanh toán; GoShip tự tính phí theo địa chỉ nhận.',
                        'Choose the carriers that can collect your parcels. Buyers pick one at checkout, and GoShip calculates the fee for their address.',
                        '集荷を依頼できる配送業者を選びます。購入者が決済時に選択し、GoShipが住所に応じて送料を計算します。',
                    )}
                </p>

                <div className="flex flex-wrap gap-2">
                    {OFFERABLE_COURIERS.map(carrier => {
                        const on = carriers.includes(carrier.code);
                        const available = collects(carrier.code);
                        return (
                            <button
                                key={carrier.code}
                                type="button"
                                onClick={() => toggleCarrier(carrier.code)}
                                aria-pressed={on}
                                disabled={!available}
                                title={available ? undefined : tx('Không lấy hàng tại khu vực của bạn', 'Does not collect in your area', 'お住まいの地域では集荷していません')}
                                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    !available
                                        ? 'cursor-not-allowed border-zinc-800/60 text-muted-foreground/50 line-through'
                                        : on
                                            ? 'border-orange-500/60 bg-orange-500/10 text-foreground'
                                            : 'border-zinc-800 text-muted-foreground hover:border-zinc-700'
                                }`}
                            >
                                {carrier.logo
                                    ? <img src={carrier.logo} alt="" className={`h-4 w-4 rounded object-contain ${available ? '' : 'opacity-40'}`} />
                                    : <Truck aria-hidden="true" className="h-4 w-4" />}
                                {carrier.short}
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {loaded.coverage ? (
                        <span>
                            {loaded.coverage.carriers.length === OFFERABLE_COURIERS.length
                                ? tx('Tất cả các hãng đều lấy hàng tại khu vực của bạn.', 'Every carrier collects in your area.', 'すべての業者がお住まいの地域で集荷します。')
                                : tx(
                                    `Hãng gạch ngang không lấy hàng tại khu vực của bạn (kiểm tra ${checkedAt}).`,
                                    `Struck-through carriers do not collect in your area (checked ${checkedAt}).`,
                                    `取り消し線の業者はお住まいの地域で集荷していません（${checkedAt}確認）。`,
                                )}
                        </span>
                    ) : loaded.hasPickup ? (
                        <span>{tx('Chưa kiểm tra hãng nào lấy hàng tại khu vực của bạn.', 'Not yet checked which carriers collect here.', '集荷可能な業者を未確認です。')}</span>
                    ) : (
                        <span>{tx('Lưu địa chỉ lấy hàng để kiểm tra hãng nào lấy hàng tại khu vực của bạn.', 'Save a pickup address to check which carriers collect here.', '集荷先を保存すると、集荷可能な業者を確認できます。')}</span>
                    )}
                    {loaded.hasPickup && (
                        <button type="button" onClick={probe} disabled={isProbing} className="inline-flex items-center gap-1 text-orange-400 hover:underline disabled:opacity-50">
                            {isProbing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            {tx('Kiểm tra lại', 'Check again', '再確認')}
                        </button>
                    )}
                </div>
            </div>

            {carriers.length === 0 && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                    {requireCarrier
                        ? tx('Chọn ít nhất một đơn vị vận chuyển để tiếp tục.', 'Pick at least one carrier to continue.', '続けるには配送業者を1社以上選んでください。')
                        : tx('Chưa chọn hãng nào — người mua sẽ thấy tất cả các hãng lấy hàng tại khu vực của bạn.', 'No carrier picked — buyers see every carrier that collects here.', '業者が未選択です。買い手には集荷可能な全業者が表示されます。')}
                </p>
            )}

            <p className="text-xs leading-5 text-muted-foreground">
                {tx(
                    'Khai giá là tùy chọn khi tạo vận đơn và không tính vào phí vận chuyển của người mua.',
                    'Declared-value insurance is optional when booking and is not added to the buyer’s shipping fee.',
                    '申告価格保険は送り状作成時の任意項目で、購入者の送料には加算されません。',
                )}
            </p>

            <Button type="button" onClick={save} disabled={isSaving || (requireCarrier && carriers.length === 0)}>
                {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                {tx('Lưu lựa chọn', 'Save choices', '選択を保存')}
            </Button>
            {summaryMode && carriers.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    {tx('Hủy', 'Cancel', 'キャンセル')}
                </Button>
            )}
        </div>
    );
}
