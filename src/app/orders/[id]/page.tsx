'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Truck, MapPin, CreditCard, Clock, Package, User, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { useToast } from '@/hooks/use-toast';
import { optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { getCarrier, getTrackingUrl, getDeliveryDays } from '@/lib/shipping-carriers';

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
  const { locale } = useLocalization();
  const { toast } = useToast();
  const id = String(params?.id || '');
  const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);
  const fmt = (n: number | null | undefined) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';
  const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(locale) : '—');

  const [order, setOrder] = useState<any | null>(null);
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
  const shippedAt = order?.auto_complete_at
    ? new Date(order.auto_complete_at).getTime() - 72 * 60 * 60 * 1000
    : order?.status === 'shipping' || order?.status === 'delivered'
      ? new Date(order.updated_at).getTime()
      : null;
  const estMax = estDays?.max ?? 5;
  // Seller may confirm-received only after est. max delivery + 3-day buffer.
  const sellerConfirmAt = shippedAt != null ? shippedAt + (estMax + 3) * 24 * 60 * 60 * 1000 : null;
  const sellerCanConfirm = sellerConfirmAt != null && nowTs >= sellerConfirmAt;
  // Buyer nudge: past est. max delivery + 2 days and still not confirmed.
  const buyerShouldConfirm = shippedAt != null && nowTs >= shippedAt + (estMax + 2) * 24 * 60 * 60 * 1000;

  // Actions + confirm dialog.
  const [acting, setActing] = useState(false);
  const [confirm, setConfirm] = useState<{ action: string; title: string; message: string; extra?: any } | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');

  const runAction = async (action: string, extra?: any) => {
    setActing(true);
    try {
      const res = await fetch('/api/marketplace/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      toast({ title: tx('Thành công', 'Done', '完了') });
      setConfirm(null); setShipOpen(false); setTrackingInput('');
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: e.message });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
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
            {order.status === 'paid' && (() => {
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
            })()}

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
              <p className="pt-1 text-xs text-muted-foreground">{tx('Phương thức', 'Method', '方法')}: {order.payment_method === 'wallet' ? tx('Ví CardVerse', 'CardVerse wallet', 'CardVerseウォレット') : 'PayOS'}</p>
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
                  <p className="font-medium">{counterparty?.display_name || counterparty?.email || '—'}</p>
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
            {isBuyer && (order.status === 'shipping' || order.status === 'delivered') && buyerShouldConfirm && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{tx(
                  'Đã quá thời gian giao dự kiến. Vui lòng xác nhận đã nhận hàng — nếu không cập nhật, bạn có thể bị trừ điểm uy tín.',
                  'Past the estimated delivery time. Please confirm receipt — failing to update may cost you reputation.',
                  '配達予定を過ぎています。受け取りを確認してください — 未更新は評価減点の対象になる場合があります。',
                )}</span>
              </div>
            )}

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
              // Buyer: confirm receipt.
              if (isBuyer && (order.status === 'shipping' || order.status === 'delivered')) {
                btns.push(
                  <Button key="confirm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirm({
                    action: 'confirm_received',
                    title: tx('Xác nhận đã nhận hàng?', 'Confirm receipt?', '受け取りを確認しますか？'),
                    message: tx('Tiền sẽ được chuyển cho người bán. Chỉ xác nhận khi bạn đã nhận đúng hàng.', 'Funds will be released to the seller. Only confirm once you have received the item.', '代金が販売者に支払われます。商品を受け取ってから確認してください。'),
                  })}>
                    <CheckCircle className="mr-2 h-4 w-4" />{tx('Đã nhận hàng', 'Received', '受け取り済み')}
                  </Button>,
                );
              }
              // Seller: confirm on buyer's behalf, only after est. delivery + 3 days.
              if (!isBuyer && (order.status === 'shipping' || order.status === 'delivered')) {
                btns.push(
                  <Button
                    key="seller-confirm"
                    disabled={!sellerCanConfirm}
                    variant={sellerCanConfirm ? 'default' : 'outline'}
                    className={`flex-1 ${sellerCanConfirm ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                    onClick={() => setConfirm({
                      action: 'confirm_received',
                      title: tx('Xác nhận đã giao thành công?', 'Confirm delivered?', '配達完了を確認しますか？'),
                      message: tx('Chỉ xác nhận khi bạn chắc chắn người mua đã nhận hàng. Tiền sẽ được ghi nhận hoàn tất.', 'Only confirm if you are sure the buyer received the item. The order will be completed.', '購入者が受け取ったことを確認できる場合のみ実行してください。'),
                    })}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />{tx('Đã giao thành công', 'Delivered', '配達完了')}
                  </Button>,
                );
              }
              if (!btns.length) return null;
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">{btns}</div>
                  {!isBuyer && (order.status === 'shipping' || order.status === 'delivered') && !sellerCanConfirm && sellerConfirmAt != null && (
                    <p className="text-xs text-muted-foreground">
                      {tx('Bạn có thể xác nhận đã giao sau', 'You can confirm delivery after', '配達確認が可能になるのは')} {dt(new Date(sellerConfirmAt).toISOString())}.
                    </p>
                  )}
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
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : tx('Xác nhận', 'Confirm', '確認')}
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
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              {carrier?.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={carrier.logo} alt="" className="h-5 w-5 rounded" />
              )}
              <span>{carrier?.name || order?.metadata?.shipping_carrier || tx('Chưa chọn', 'Not set', '未設定')}</span>
              <span className="ml-auto text-xs text-muted-foreground">{tx('Người mua đã chọn', 'Chosen by buyer', '購入者が選択')}</span>
            </div>
            {order?.metadata?.shipping_carrier !== 'self' && (
              <Input value={trackingInput} onChange={e => setTrackingInput(e.target.value)} placeholder={tx('VD: LWtxxxxxxx', 'e.g. LWtxxxxxxx', '例: LWtxxxxxxx')} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipOpen(false)} disabled={acting}>{tx('Huỷ', 'Cancel', 'キャンセル')}</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              disabled={acting || (order?.metadata?.shipping_carrier !== 'self' && !trackingInput.trim())}
              onClick={() => runAction('ship', { shipping_provider: order?.metadata?.shipping_carrier, tracking_number: trackingInput.trim() })}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : tx('Giao hàng', 'Ship', '発送')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
