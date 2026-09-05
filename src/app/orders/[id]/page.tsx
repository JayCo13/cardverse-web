'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { LiveClock } from '@/components/live-clock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Truck, MapPin, CreditCard, Clock, Package, User, CheckCircle, AlertTriangle, Video } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { localizeFinancialApiError } from '@/lib/financial-api-errors';
import { useToast } from '@/hooks/use-toast';
import { optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { getCarrier, getTrackingUrl, getDeliveryDays, SHIPPING_CARRIERS, sellerSuppliesTracking } from '@/lib/shipping-carriers';
import { VerifiedSellerBadge } from '@/components/verified-seller-badge';
import { ParcelTrackingDialog } from '@/components/parcel-tracking-dialog';
import { PackingVideoField } from '@/components/packing-video-field';
import { getCloudinarySignature, uploadVideoDirectToCloudinary } from '@/lib/cloudinary-direct';
import {
  EVIDENCE_VIDEO_ACCEPT,
  EVIDENCE_VIDEO_FOLDER,
  EVIDENCE_VIDEO_MAX_BYTES,
  isAcceptableEvidenceVideoFile,
} from '@/lib/evidence-video';

const STATUS_STYLE: Record<string, string> = {
  pending_payment: 'bg-gray-500/15 text-gray-300',
  paid: 'bg-amber-500/15 text-amber-300',
  shipping: 'bg-blue-500/15 text-blue-300',
  delivered: 'bg-blue-500/15 text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
  disputed: 'bg-red-500/15 text-red-300',
};

export default function OrderDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { locale, t } = useLocalization();
  const { toast } = useToast();
  const id = String(params?.id || '');
  const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);
  const fmt = (n: number | null | undefined) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'VND' }).format(Number(n || 0));
  const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(locale) : '—');

  const [order, setOrder] = useState<any | null>(null);
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');


  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/marketplace/orders/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Not found');
      setOrder(data.order); setRole(data.viewerRole); setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Localized order status label.
  const statusLabel = (s: string) => ({
    pending_payment: tx('Chờ thanh toán', 'Awaiting payment', '支払い待ち'),
    paid: tx('Chuẩn bị hàng', 'Preparing', '発送準備中'),
    shipping: tx('Đang giao', 'Shipping', '配送中'),
    delivered: tx('Đã giao', 'Delivered', '配達済み'),
    completed: tx('Hoàn tất', 'Completed', '完了'),
    cancelled: tx('Đã huỷ', 'Cancelled', 'キャンセル'),
    disputed: tx('Khiếu nại', 'Disputed', '異議申立'),
  } as Record<string, string>)[s] || s;

  const isBuyer = role === 'buyer';
  const carrier = order ? getCarrier(order.metadata?.shipping_carrier) : undefined;
  const trackingUrl = order ? getTrackingUrl(order.metadata?.shipping_carrier, order.tracking_number) : null;
  const bundleSel: { title: string; price: number }[] = Array.isArray(order?.metadata?.bundle_selection) ? order.metadata.bundle_selection : [];
  const counterparty = order ? (isBuyer ? order.seller : order.buyer) : null;

  // Shipping timing (from carrier pickup → delivery estimate).
  const estDays = order ? getDeliveryDays(order.metadata?.shipping_carrier || order.shipping_provider) : null;
  // The order escalates to admin review at auto_complete_at if the buyer never
  // confirms (money is held, not paid to the seller). Nudge the buyer as that
  // deadline approaches (within the last 2 days).
  const escalateAt = order?.auto_complete_at ? new Date(order.auto_complete_at).getTime() : null;
  const confirmReminderAt = escalateAt != null ? escalateAt - 2 * 24 * 60 * 60 * 1000 : null;

  // Actions + confirm dialog.
  const [acting, setActing] = useState(false);
  const [confirm, setConfirm] = useState<{ action: string; title: string; message: string; extra?: any } | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  // Orders placed before checkout recorded the quoted carrier have none, so the
  // seller picks the one they actually shipped with. Seeded from the order when
  // it does carry one, in which case the dialog just shows it.
  const [shipCarrier, setShipCarrier] = useState('');
  const [packingVideoUrl, setPackingVideoUrl] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const orderCarrier: string | undefined = order?.metadata?.shipping_carrier;
  const effectiveCarrier = orderCarrier || shipCarrier;
  const actionKeys = useRef<Record<string, string>>({});

  /** Signed direct upload to the evidence folder. Returns null on any failure. */
  const uploadEvidenceVideo = async (file: File): Promise<string | null> => {
    if (!isAcceptableEvidenceVideoFile(file)) {
      toast({
        variant: 'destructive',
        title: tx('Video không hợp lệ', 'Invalid video', '無効な動画'),
        description: tx(
          `Chọn một tệp video dưới ${Math.round(EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))}MB.`,
          `Pick a video file under ${Math.round(EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))}MB.`,
          `${Math.round(EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))}MB 未満の動画を選んでください。`,
        ),
      });
      return null;
    }
    setVideoBusy(true);
    try {
      const signature = await getCloudinarySignature(EVIDENCE_VIDEO_FOLDER);
      const { secureUrl } = await uploadVideoDirectToCloudinary(file, signature);
      return secureUrl;
    } catch (e: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: e.message });
      return null;
    } finally {
      setVideoBusy(false);
    }
  };

  const runAction = async (action: string, extra?: any) => {
    const fingerprint = `${id}:${action}:${JSON.stringify(extra || {})}`;
    actionKeys.current[fingerprint] ||= crypto.randomUUID();
    setActing(true);
    try {
      const res = await fetch('/api/marketplace/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': actionKeys.current[fingerprint],
        },
        body: JSON.stringify({ order_id: id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(localizeFinancialApiError(t, data.code, tx('Lỗi', 'Error', 'エラー')));
      }
      delete actionKeys.current[fingerprint];
      toast({ title: tx('Thành công', 'Done', '完了') });
      setConfirm(null); setShipOpen(false); setTrackingInput(''); setPackingVideoUrl(null);
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: e.message });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4 h-9 px-2 text-muted-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> {tx('Quay lại', 'Back', '戻る')}
        </Button>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">{error}</div>
        ) : order ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
              <div>
                <p className="text-sm text-muted-foreground">{tx('Đơn hàng', 'Order', '注文')} #{String(order.id).slice(0, 8).toUpperCase()}</p>
                <p className="text-xs text-muted-foreground">{dt(order.created_at)}</p>
              </div>
              <Badge className={`rounded-full px-3 py-1 ${STATUS_STYLE[order.status] || 'bg-muted'}`}>{statusLabel(order.status)}</Badge>
            </div>

            {/* Countdown */}
            {order.status === 'paid' && <LiveClock until={order.ship_deadline ? Date.parse(order.ship_deadline) : Date.parse(order.created_at) + 86400000}>{nowTs => {
              const deadlineTs = order.ship_deadline ? new Date(order.ship_deadline).getTime() : new Date(order.created_at).getTime() + 24 * 3600 * 1000;
              const rem = deadlineTs - nowTs;
              if (rem <= 0) {
                return <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"><Clock className="h-4 w-4" />{tx('Quá hạn giao hàng — đơn sẽ tự huỷ & hoàn tiền.', 'Overdue — the order will auto-cancel and refund.', '発送期限切れ — 自動キャンセル・返金されます。')}</div>;
              }
              const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
              return (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  <Clock className="h-4 w-4" />
                  {isBuyer ? tx('Người bán cần giao trong', 'Seller must ship within', '販売者の発送期限まで') : tx('Bạn cần nhập mã vận đơn trong', 'You must upload tracking within', '追跡番号を入力する残り時間')}{' '}
                  <b className="tabular-nums">{h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s</b>
                </div>
              );
            }}</LiveClock>}

            {/* Product */}
            <div className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4 text-orange-400" />{tx('Sản phẩm', 'Item', '商品')}</h2>
              <div className="flex gap-3">
                {order.card?.image_url && (
                  <Image src={optimizeCloudinaryUrl(order.card.image_url, 200)} alt="" width={64} height={88} className="h-[88px] w-16 rounded object-cover" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold">{order.card?.name}</p>
                  <p className="text-xs text-muted-foreground">{order.card?.category}{order.card?.condition ? ` · ${order.card.condition}` : ''}</p>
                </div>
              </div>
              {bundleSel.length > 0 && (
                <div className="space-y-1 rounded-lg border p-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">{tx('Thẻ đã mua', 'Cards purchased', '購入カード')} ({bundleSel.length})</p>
                  {bundleSel.map((it, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="min-w-0 truncate">{it.title || `Thẻ ${i + 1}`}</span>
                      <span className="shrink-0 font-medium text-orange-500">{fmt(it.price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Shipping */}
            <div className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4 text-orange-400" />{tx('Vận chuyển', 'Shipping', '配送')}</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{tx('Đơn vị', 'Carrier', '配送業者')}:</span>
                {carrier?.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={carrier.logo} alt="" className="h-5 w-5 rounded" />
                )}
                <span className="font-medium">{carrier?.name || tx('Chưa chọn', 'Not set', '未設定')}</span>
              </div>
              {order.tracking_number && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{tx('Mã vận đơn', 'Tracking', '追跡番号')}: </span>
                  {trackingUrl ? (
                    <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-orange-400 underline underline-offset-2">{order.tracking_number} ↗</a>
                  ) : (
                    <span className="font-medium">{order.tracking_number}</span>
                  )}
                </div>
              )}
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{order.to_name} · {order.to_phone}</p>
                  <p className="text-muted-foreground">{[order.to_address_detail, order.to_ward_name, order.to_district_name, order.to_province_name].filter(Boolean).join(', ')}</p>
                </div>
              </div>
              {(order.status === 'shipping' || order.status === 'delivered') && estDays && (
                <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                  {tx(
                    `Dự kiến giao trong ${estDays.min}–${estDays.max} ngày kể từ khi đơn vị vận chuyển lấy hàng.`,
                    `Estimated delivery in ${estDays.min}–${estDays.max} days from carrier pickup.`,
                    `集荷から${estDays.min}〜${estDays.max}日で配達予定。`,
                  )}
                  <span className="block text-blue-300/70">
                    {tx(
                      'Trạng thái "đã lấy hàng" chỉ hiển thị trên trang tra cứu của đơn vị vận chuyển.',
                      'The "picked up" status only appears on the carrier\'s tracking page.',
                      '「集荷済み」ステータスは配送業者の追跡ページのみで表示されます。',
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Payment */}
            <div className="space-y-2 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-orange-400" />{tx('Thanh toán', 'Payment', '支払い')}</h2>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tx('Tiền hàng', 'Item price', '商品代金')}</span><span>{fmt(order.amount)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tx('Phí vận chuyển', 'Shipping fee', '送料')}</span><span>{fmt(order.shipping_fee)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold"><span>{tx('Tổng', 'Total', '合計')}</span><span className="text-orange-500">{fmt(order.total_paid)}</span></div>
              <p className="pt-1 text-xs text-muted-foreground">{tx('Phương thức', 'Method', '方法')}: {order.payment_method === 'wallet' ? tx('Ví CardVerseHub', 'CardVerseHub wallet', 'CardVerseHubウォレット') : 'PayOS'}</p>
            </div>

            {/* Counterparty */}
            <div className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4 text-orange-400" />{isBuyer ? tx('Người bán', 'Seller', '販売者') : tx('Người mua', 'Buyer', '購入者')}</h2>
              <div className="flex items-center gap-3">
                {counterparty?.profile_image_url ? (
                  <Image src={counterparty.profile_image_url} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 font-bold text-white">{(counterparty?.display_name || counterparty?.email || 'C').charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <p className="flex items-center gap-1 font-medium">
                    <span className="truncate">{counterparty?.display_name || counterparty?.email || '—'}</span>
                    {isBuyer && <VerifiedSellerBadge verified={counterparty?.seller_verified} />}
                  </p>
                  {isBuyer && counterparty?.seller_rating != null && (
                    <p className="text-xs text-muted-foreground">{Number(counterparty.seller_rating).toFixed(1)}% · {counterparty.seller_review_count || 0} {tx('đã bán', 'sold', '販売')}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-1 rounded-xl border bg-card p-5 text-sm">
              <h2 className="mb-2 text-sm font-semibold">{tx('Mốc thời gian', 'Timeline', 'タイムライン')}</h2>
              <div className="flex justify-between"><span className="text-muted-foreground">{tx('Tạo đơn', 'Created', '作成')}</span><span>{dt(order.created_at)}</span></div>
              {order.ship_deadline && <div className="flex justify-between"><span className="text-muted-foreground">{tx('Hạn giao', 'Ship deadline', '発送期限')}</span><span>{dt(order.ship_deadline)}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">{tx('Cập nhật', 'Updated', '更新')}</span><span>{dt(order.updated_at)}</span></div>
            </div>

            {/* Buyer reminder (part 5): overdue to confirm receipt */}
            {isBuyer && (order.status === 'shipping' || order.status === 'delivered') && confirmReminderAt != null && (
              <LiveClock until={confirmReminderAt}>{now => now >= confirmReminderAt && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{tx(
                  'Đã quá thời gian giao dự kiến. Nếu đã nhận, hãy bấm "Đã nhận hàng". Nếu chưa nhận hoặc có vấn đề, hãy "Báo cáo admin". Nếu bạn không cập nhật, đơn sẽ tự động chuyển cho quản trị viên kiểm tra (tiền vẫn được giữ an toàn).',
                  'Past the estimated delivery time. If it arrived, tap "Received". If not, "Report to admin". If you do nothing, the order is automatically escalated to an admin for review (your money stays safe).',
                  '配達予定を過ぎています。届いた場合は「受け取り済み」、問題がある場合は「管理者に報告」を押してください。未対応の場合は自動的に管理者の確認に回されます（代金は安全に保持されます）。',
                )}</span>
              </div>
              )}</LiveClock>
            )}

            {/* Dispute evidence — the videos that decide who is heard */}
            {['paid', 'shipping', 'delivered', 'disputed'].includes(order.status) && (() => {
              const sellerVideo: string | null = order.seller_packing_video_url || null;
              const buyerVideo: string | null = order.buyer_unboxing_video_url || null;
              // Read at render rather than from the LiveClock tick: the window is
              // 72h, so a per-second clock buys nothing here.
              const windowOpen = !order.auto_complete_at || new Date(order.auto_complete_at).getTime() > Date.now();
              // Nothing to film yet at 'paid' — the parcel has not moved. What
              // each side needs at that point is the warning, not the control.
              const beforeDispatch = order.status === 'paid';
              const canUpload = isBuyer && !buyerVideo && windowOpen && !beforeDispatch;
              const row = (label: string, url: string | null, missingHint: string) => (
                <div className="flex items-center gap-2 text-sm">
                  <Video className={`h-4 w-4 shrink-0 ${url ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-orange-300 underline">
                      {tx('Xem', 'View', '見る')}
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">{missingHint}</span>
                  )}
                </div>
              );
              return (
                <div className="space-y-3 rounded-xl border border-border/60 p-4">
                  <p className="text-sm font-semibold">{tx('Bằng chứng tranh chấp', 'Dispute evidence', '紛争の証拠')}</p>

                  {/* The moment each side can still act on this. A packing video
                      is only accepted at dispatch, so telling the seller once
                      they are already at the ship dialog is telling them late. */}
                  {beforeDispatch && !isBuyer && (
                    <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs leading-5 text-orange-200">
                      {tx(
                        'Quay video khi bạn đang đóng gói. Hệ thống chỉ nhận video ở đúng bước bấm “Giao hàng” — không đính thêm được về sau. Nếu có tranh chấp mà bạn không có video còn người mua có, phần thua thuộc về bạn.',
                        'Film while you pack. The video is only accepted at the moment you press Ship — it cannot be attached later. If a dispute follows and you have no video while the buyer does, you lose it.',
                        '梱包中に撮影してください。動画は「発送」を押す時点でのみ受け付けます。後から追加はできません。',
                      )}
                    </p>
                  )}
                  {beforeDispatch && isBuyer && (
                    <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs leading-5 text-orange-200">
                      {tx(
                        'Khi hàng tới, hãy quay video lúc mở hộp — quay liền mạch từ lúc phong bì còn nguyên. Đơn đã giao mà bạn không có video thì tranh chấp sẽ nghiêng về người bán, kể cả khi thẻ sai hoặc thiếu.',
                        'When the parcel arrives, film the unboxing — one unbroken take starting with the envelope still sealed. On a delivered order with no video from you, a dispute goes to the seller, even for a wrong or missing card.',
                        '荷物が届いたら、封を切る前から一度の撮影で開封を記録してください。動画がない場合、配達済みの注文では販売者が有利になります。',
                      )}
                    </p>
                  )}

                  {row(
                    tx('Video đóng gói của người bán', 'Seller packing video', '販売者の梱包動画'),
                    sellerVideo,
                    tx('Không có', 'None', 'なし'),
                  )}
                  {row(
                    tx('Video mở hộp của người mua', 'Buyer unboxing video', '購入者の開封動画'),
                    buyerVideo,
                    tx('Chưa có', 'Not yet', '未提出'),
                  )}
                  {!beforeDispatch && (
                  <p className="rounded-lg bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
                    {tx(
                      'Quay video là không bắt buộc, nhưng đó là thứ quyết định khi có tranh chấp: bên nào không chứng minh được thì thua điểm đó. Nếu cả hai đều không có, hệ thống không phân xử và tiền được giải ngân cho người bán.',
                      'Recording is optional, but it is what decides a dispute: whoever cannot show their side loses that point. If neither side has a video the platform does not arbitrate, and the funds go to the seller.',
                      '撮影は任意ですが、紛争の判断材料になります。証明できない側がその点を失い、双方に動画がない場合は販売者に支払われます。',
                    )}
                  </p>
                  )}
                  {canUpload && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        {order.auto_complete_at
                          ? tx(`Nộp trước ${dt(order.auto_complete_at)} — sau đó không nhận nữa.`,
                              `Submit before ${dt(order.auto_complete_at)} — not accepted after that.`,
                              `${dt(order.auto_complete_at)} までに提出してください。`)
                          : tx('Nộp trước khi đơn đóng.', 'Submit before the order closes.', '注文が閉じる前に提出してください。')}
                      </p>
                      <input
                        type="file"
                        accept={EVIDENCE_VIDEO_ACCEPT}
                        disabled={videoBusy || acting}
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          const url = await uploadEvidenceVideo(file);
                          // Write-once at the database, so this only ever runs
                          // for a real first submission.
                          if (url) await runAction('submit_unboxing_video', { video_url: url });
                        }}
                        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-orange-500/15 file:px-3 file:py-1.5 file:text-orange-300"
                      />
                      {videoBusy && <p className="text-xs text-muted-foreground">{tx('Đang tải lên…', 'Uploading…', 'アップロード中…')}</p>}
                    </div>
                  )}
                  {isBuyer && !buyerVideo && !windowOpen && (
                    <p className="text-xs text-amber-300">
                      {tx('Đã hết hạn nộp video cho đơn này.', 'The window for submitting a video has closed.', '動画の提出期限が過ぎました。')}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Actions */}
            {(() => {
              const btns: ReactNode[] = [];
              // Seller: upload tracking to ship (carrier already chosen by buyer).
              if (!isBuyer && order.status === 'paid') {
                btns.push(
                  <Button key="ship" className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={() => setShipOpen(true)}>
                    <Truck className="mr-2 h-4 w-4" />{tx('Nhập mã vận đơn & giao', 'Enter tracking & ship', '追跡番号を入力して発送')}
                  </Button>,
                );
              }
              // Buyer: follow the parcel, or report a problem to admin.
              //
              // There is no "confirm receipt" button any more: escrow releases
              // on its own 72h after a carrier confirms delivery, so pressing
              // something added nothing. What the buyer wants here is to see
              // where the parcel is.
              if (isBuyer && (order.status === 'shipping' || order.status === 'delivered')) {
                btns.push(
                  <Button key="track" variant="outline" className="flex-1" onClick={() => setTrackOpen(true)}>
                    <Truck className="mr-2 h-4 w-4" />{tx('Theo dõi đơn', 'Track parcel', '配送を追跡')}
                  </Button>,
                  <Button key="report" variant="outline" className="flex-1 border-red-500/40 text-red-300 hover:bg-red-500/10" onClick={() => setConfirm({
                    action: 'dispute',
                    title: tx('Báo cáo cho quản trị viên?', 'Report to admin?', '管理者に報告しますか？'),
                    message: order.buyer_unboxing_video_url
                      ? tx('Dùng khi chưa nhận được hàng / hàng lỗi / giao trễ. Đơn sẽ được giữ và chuyển cho admin kiểm tra. Tiền của bạn vẫn được giữ an toàn.', 'Use this if the item has not arrived / is faulty / is late. The order is held and sent to an admin to review. Your money stays safe.', '未着・不良・遅延の場合に使用します。注文は保留され管理者が確認します。')
                      : tx('Bạn chưa nộp video mở hộp. Vẫn báo cáo được, nhưng nếu người bán có video đóng gói thì đơn sẽ được giải ngân cho họ. Nên nộp video trước khi báo cáo.', 'You have not submitted an unboxing video. You can still report, but if the seller has a packing video the funds will go to them. Submit a video first if you can.', '開封動画が未提出です。報告はできますが、販売者に梱包動画がある場合は販売者に支払われます。'),
                    extra: { dispute_reason: tx('Người mua báo cáo (chưa nhận / lỗi / trễ)', 'Buyer reported (not received / faulty / late)', '購入者の報告（未着・不良・遅延）') },
                  })}>
                    <AlertTriangle className="mr-2 h-4 w-4" />{tx('Báo cáo admin', 'Report to admin', '管理者に報告')}
                  </Button>,
                );
              }
              if (!btns.length) return null;
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">{btns}</div>
                </div>
              );
            })()}

            <Button variant="outline" className="w-full" onClick={() => router.push('/orders')}>
              {tx('Về danh sách đơn hàng', 'Back to orders', '注文一覧へ')}
            </Button>
          </div>
        ) : null}
      </main>

      {/* Confirm dialog for lifecycle actions */}
      <Dialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={acting}>{tx('Huỷ', 'Cancel', 'キャンセル')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => confirm && runAction(confirm.action, confirm.extra)} disabled={acting}>
              {tx('Xác nhận', 'Confirm', '確認')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ship dialog — carrier already chosen by the buyer, seller enters tracking */}
      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('Nhập mã vận đơn', 'Enter tracking number', '追跡番号を入力')}</DialogTitle>
            <DialogDescription>{tx('Người mua sẽ nhận email + thông báo với mã vận đơn.', 'The buyer will be notified by email with the tracking number.', '購入者に追跡番号がメールで通知されます。')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {orderCarrier ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                {carrier?.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={carrier.logo} alt="" className="h-5 w-5 rounded" />
                )}
                <span>{carrier?.name || orderCarrier}</span>
                <span className="ml-auto text-xs text-muted-foreground">{tx('Người mua đã chọn', 'Chosen by buyer', '購入者が選択')}</span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">{tx('Đơn vị vận chuyển', 'Carrier', '配送業者')}</p>
                <div className="flex flex-wrap gap-2">
                  {SHIPPING_CARRIERS.map(c => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setShipCarrier(c.code)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${shipCarrier === c.code ? 'border-orange-500 bg-orange-500/15 text-orange-300' : 'border-border/60 text-muted-foreground hover:border-orange-500/40'}`}
                    >
                      {c.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.logo} alt="" className="h-5 w-5 rounded" />
                      ) : (
                        <Truck className="h-4 w-4" />
                      )}
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sellerSuppliesTracking(effectiveCarrier) && (
              <Input value={trackingInput} onChange={e => setTrackingInput(e.target.value)} placeholder={tx('VD: LWtxxxxxxx', 'e.g. LWtxxxxxxx', '例: LWtxxxxxxx')} />
            )}
            {effectiveCarrier && (
              <PackingVideoField value={packingVideoUrl} onChange={setPackingVideoUrl} locale={locale} disabled={acting} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipOpen(false)} disabled={acting}>{tx('Huỷ', 'Cancel', 'キャンセル')}</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              disabled={acting || !effectiveCarrier || (sellerSuppliesTracking(effectiveCarrier) && !trackingInput.trim())}
              onClick={() => runAction('ship', {
                shipping_provider: effectiveCarrier,
                tracking_number: trackingInput.trim(),
                packing_video_url: packingVideoUrl,
              })}
            >
              {tx('Giao hàng', 'Ship', '発送')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ParcelTrackingDialog
        open={trackOpen}
        onOpenChange={setTrackOpen}
        orderId={id}
        locale={locale}
        title={tx('Theo dõi đơn', 'Track parcel', '配送を追跡')}
        closeLabel={tx('Đóng', 'Close', '閉じる')}
      />

    </div>
  );
}
