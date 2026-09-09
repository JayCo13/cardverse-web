'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, Check, ExternalLink, Loader2, Truck } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { carrierStatusLabel } from '@/lib/carrier-status-labels';
import { getCarrier } from '@/lib/shipping-carriers';

/**
 * The parcel's journey, without leaving the site.
 *
 * The button used to open the carrier's own page in a new tab. That page is
 * built for their customers rather than ours — it asks for a code, shows the
 * order's own history to nobody who is not signed in there, and for the first
 * hours of a shipment's life does not know it exists at all. Here the reader is
 * already identified by the order they are looking at, so the sequence can just
 * be shown.
 *
 * The carrier's page stays reachable as a link when there is a real one, since
 * it carries scans GoShip does not relay.
 */

type Event = {
    code: number | null;
    status: string | null;
    text: string | null;
    detail: string | null;
    at: string | null;
};

type Tracking = {
    gcode: string | null;
    degraded?: boolean;
    carrierName: string | null;
    carrierCode: string | null;
    trackingUrl: string | null;
    expected?: string | null;
    events: Event[];
};

const COPY = {
    'vi-VN': {
        title: 'Hành trình đơn hàng', loading: 'Đang lấy thông tin...',
        failed: 'Không lấy được hành trình.', empty: 'Chưa có cập nhật nào từ đơn vị vận chuyển.',
        notBooked: 'Đơn này chưa có vận đơn.',
        gcode: 'Mã vận đơn sàn', carrierCode: 'Mã hãng', carrier: 'Đơn vị vận chuyển',
        expected: 'Dự kiến giao', openCarrier: 'Xem trên trang hãng',
        degraded: 'Không kết nối được đơn vị vận chuyển, đang hiển thị trạng thái ghi nhận gần nhất.',
        waiting: 'Vận đơn đã tạo, chờ hãng tiếp nhận. Khi hãng nhận sẽ có mã riêng của họ.',
    },
    'en-US': {
        title: 'Parcel journey', loading: 'Fetching...',
        failed: 'Could not load the journey.', empty: 'No updates from the carrier yet.',
        notBooked: 'No waybill for this order yet.',
        gcode: 'Platform code', carrierCode: 'Carrier code', carrier: 'Carrier',
        expected: 'Expected', openCarrier: "Open the carrier's page",
        degraded: 'The carrier could not be reached; showing the last status we recorded.',
        waiting: 'Waybill created, waiting for the carrier to accept it. Their own code appears then.',
    },
    'ja-JP': {
        title: '配送状況', loading: '取得中...',
        failed: '配送状況を取得できませんでした。', empty: '配送業者からの更新はまだありません。',
        notBooked: 'この注文にはまだ送り状がありません。',
        gcode: 'プラットフォーム番号', carrierCode: '業者番号', carrier: '配送業者',
        expected: 'お届け予定', openCarrier: '業者のページを開く',
        degraded: '配送業者に接続できないため、最後に記録した状態を表示しています。',
        waiting: '送り状を作成しました。業者が受け付けると業者側の番号が付きます。',
    },
} as const;

export function ShipmentTrackingDialog({
    orderId,
    open,
    onOpenChange,
}: {
    orderId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { locale } = useLocalization();
    const copy = COPY[locale as keyof typeof COPY] ?? COPY['vi-VN'];

    const [data, setData] = useState<Tracking | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setBusy(true); setError(null);
        try {
            const res = await fetch(`/api/shipping/track?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store' });
            const body = await res.json();
            if (!res.ok) { setError(body.error || copy.failed); return; }
            setData(body.data as Tracking);
        } catch {
            setError(copy.failed);
        } finally {
            setBusy(false);
        }
    }, [orderId, copy.failed]);

    // Fetched when opened, never held from an earlier visit: a parcel moves
    // between one look and the next, which is the whole reason to look.
    useEffect(() => { if (open) void load(); }, [open, load]);

    const dt = (iso: string | null) =>
        iso ? new Date(iso).toLocaleString(locale === 'vi-VN' ? 'vi-VN' : locale === 'ja-JP' ? 'ja-JP' : 'en-US') : '';

    const carrier = getCarrier(data?.carrierName ?? '');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Truck className="h-5 w-5 text-orange-400" />{copy.title}
                    </DialogTitle>
                    <DialogDescription className="sr-only">{copy.title}</DialogDescription>
                </DialogHeader>

                {busy && (
                    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />{copy.loading}
                    </p>
                )}

                {!busy && error && (
                    <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                    </p>
                )}

                {!busy && !error && data && (
                    <div className="space-y-4">
                        {!data.gcode ? (
                            <p className="text-sm text-muted-foreground">{copy.notBooked}</p>
                        ) : (
                            <>
                                <dl className="space-y-1.5 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-muted-foreground">{copy.gcode}</dt>
                                        <dd className="font-mono font-medium">{data.gcode}</dd>
                                    </div>
                                    {(carrier?.name || data.carrierName) && (
                                        <div className="flex justify-between gap-3">
                                            <dt className="text-muted-foreground">{copy.carrier}</dt>
                                            <dd className="font-medium">{carrier?.name || data.carrierName}</dd>
                                        </div>
                                    )}
                                    {data.carrierCode && (
                                        <div className="flex justify-between gap-3">
                                            <dt className="text-muted-foreground">{copy.carrierCode}</dt>
                                            <dd className="font-mono font-medium">{data.carrierCode}</dd>
                                        </div>
                                    )}
                                    {data.expected && (
                                        <div className="flex justify-between gap-3">
                                            <dt className="text-muted-foreground">{copy.expected}</dt>
                                            <dd className="font-medium">{data.expected}</dd>
                                        </div>
                                    )}
                                </dl>

                                {data.degraded && (
                                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-200">
                                        {copy.degraded}
                                    </p>
                                )}

                                {data.events.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{copy.empty}</p>
                                ) : (
                                    <ol className="space-y-0">
                                        {data.events.map((e, i) => {
                                            const last = i === data.events.length - 1;
                                            return (
                                                <li key={`${e.code}-${e.at}-${i}`} className="flex gap-3">
                                                    <div className="flex flex-col items-center">
                                                        <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${last ? 'bg-orange-500 text-black' : 'bg-muted-foreground/30'}`}>
                                                            {last && <Check className="h-2.5 w-2.5" />}
                                                        </span>
                                                        {/* The line stops at the last event rather than
                                                            trailing past it: the journey has got this far
                                                            and no further. */}
                                                        {!last && <span className="w-px flex-1 bg-border" />}
                                                    </div>
                                                    <div className={`min-w-0 pb-4 ${last ? '' : 'opacity-70'}`}>
                                                        <p className="text-sm font-medium">
                                                            {e.text || (e.status ? carrierStatusLabel(e.status, locale) : '—')}
                                                        </p>
                                                        {e.detail && e.detail !== e.text && (
                                                            <p className="text-xs text-muted-foreground">{e.detail}</p>
                                                        )}
                                                        <p className="text-xs text-muted-foreground/70">{dt(e.at)}</p>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}

                                {!data.carrierCode && data.events.length > 0 && (
                                    <p className="rounded-lg bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
                                        {copy.waiting}
                                    </p>
                                )}

                                {data.trackingUrl && (
                                    <Button variant="outline" className="w-full" asChild>
                                        <a href={data.trackingUrl} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="mr-2 h-4 w-4" />{copy.openCarrier}
                                        </a>
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
