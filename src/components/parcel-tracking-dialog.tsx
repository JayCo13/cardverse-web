"use client";

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { getCarrier, getTrackingUrl } from '@/lib/shipping-carriers';

/**
 * The parcel's journey for one order, read live from the tracking service.
 *
 * Shared by the order list and the order detail page. Both replaced a
 * "confirm receipt" button with this: escrow releases on its own 72h after a
 * carrier confirms delivery, so the buyer no longer has anything to press —
 * what they actually want at that point is to know where the parcel is.
 */

type TrackingStatus = {
  status: string | null;
  subStatus: string | null;
  at: string | null;
  carrier: string;
  trackingNumber: string;
  supported: boolean;
  events: { time: string | null; description: string | null; location: string | null }[];
};

/** The tracking service's nine main statuses, in the reader's language. */
const CARRIER_STATUS_LABELS: Record<string, { vi: string; en: string; ja: string }> = {
  NotFound: { vi: 'Hãng chưa có thông tin', en: 'No carrier data yet', ja: '配送業者の情報なし' },
  InfoReceived: { vi: 'Đã tiếp nhận thông tin', en: 'Info received', ja: '情報受付済み' },
  InTransit: { vi: 'Đang vận chuyển', en: 'In transit', ja: '輸送中' },
  OutForDelivery: { vi: 'Đang giao đến bạn', en: 'Out for delivery', ja: '配達中' },
  AvailableForPickup: { vi: 'Chờ nhận tại điểm giao', en: 'Available for pickup', ja: '受取可能' },
  Delivered: { vi: 'Đã giao thành công', en: 'Delivered', ja: '配達完了' },
  DeliveryFailure: { vi: 'Giao không thành công', en: 'Delivery failed', ja: '配達失敗' },
  Exception: { vi: 'Có sự cố', en: 'Exception', ja: '異常' },
  Expired: { vi: 'Quá hạn theo dõi', en: 'Tracking expired', ja: '追跡期限切れ' },
};

export function ParcelTrackingDialog({
  open, onOpenChange, orderId, locale, title, closeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  locale: string;
  title: string;
  closeLabel: string;
}) {
  const [info, setInfo] = useState<TrackingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);

  // Fetched when the dialog opens rather than with the list: it is one upstream
  // call per order, and most orders are never opened.
  useEffect(() => {
    if (!open || !orderId) { setInfo(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/shipping/tracking-status?order_id=${encodeURIComponent(orderId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setInfo(d?.error ? null : d); })
      .catch(() => { if (!cancelled) setInfo(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, orderId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {info?.trackingNumber ? `${getCarrier(info.carrier)?.short || info.carrier}: ${info.trackingNumber}` : ''}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{tx('Đang tải…', 'Loading…', '読み込み中…')}</p>
        ) : !info ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {tx('Không tải được thông tin theo dõi.', 'Could not load tracking.', '取得できませんでした。')}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-sm font-semibold">
                {(CARRIER_STATUS_LABELS[info.status || 'NotFound'] || CARRIER_STATUS_LABELS.NotFound)[
                  locale === 'ja-JP' ? 'ja' : locale === 'en-US' ? 'en' : 'vi'
                ]}
              </p>
              {info.at && <p className="mt-0.5 text-xs text-muted-foreground">{new Date(info.at).toLocaleString(locale)}</p>}
            </div>

            {/* A carrier we cannot track is said so plainly, rather than shown as
                an empty timeline that reads like a failure. */}
            {!info.supported ? (
              <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                <p>{tx(
                  'Đơn vị vận chuyển này chưa hỗ trợ theo dõi tự động. Bạn xem trực tiếp trên trang của hãng.',
                  'This carrier is not covered by automatic tracking. Check the carrier’s own page.',
                  'この配送業者は自動追跡に対応していません。業者のサイトでご確認ください。',
                )}</p>
                {getTrackingUrl(info.carrier, info.trackingNumber) && (
                  <a
                    href={getTrackingUrl(info.carrier, info.trackingNumber) as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-orange-400 underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {getCarrier(info.carrier)?.name || info.carrier}
                  </a>
                )}
              </div>
            ) : info.events.length === 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">{tx(
                'Hãng vận chuyển chưa có cập nhật nào. Hành trình sẽ hiện sau khi hãng lấy hàng.',
                'No carrier updates yet. Events appear once the parcel is collected.',
                '配送業者からの更新はまだありません。集荷後に表示されます。',
              )}</p>
            ) : (
              <ol className="space-y-3 border-l border-border/60 pl-4">
                {info.events.map((e, i) => (
                  <li key={i} className="relative text-sm">
                    <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${i === 0 ? 'bg-orange-500' : 'bg-border'}`} />
                    <p className={i === 0 ? 'font-medium' : ''}>{e.description || '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {[e.time ? new Date(e.time).toLocaleString(locale) : null, e.location].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{closeLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
