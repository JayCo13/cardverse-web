
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Truck, CheckCircle, XCircle, AlertTriangle, Clock, Loader2, ShoppingBag, Store, ExternalLink, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SHIPPING_CARRIERS, getTrackingUrl, getCarrier, getDeliveryDays } from '@/lib/shipping-carriers';
import Image from 'next/image';

type Order = {
  id: string;
  card_id: string;
  seller_id: string;
  buyer_id: string;
  amount: number;
  platform_fee: number;
  total_paid: number;
  shipping_fee: number;
  payment_method: string;
  status: string;
  tracking_number: string | null;
  shipping_provider: string | null;
  metadata: { shipping_carrier?: string; bundle_selection?: { title: string; price: number }[] } | null;
  ship_deadline: string | null;
  shipping_address: string | null;
  ghn_order_code: string | null;
  ghn_status: string | null;
  ghn_expected_delivery: string | null;
  auto_complete_at: string | null;
  dispute_reason: string | null;
  to_name: string | null;
  to_phone: string | null;
  to_district_name: string | null;
  to_province_name: string | null;
  to_ward_name: string | null;
  to_address_detail: string | null;
  created_at: string;
  updated_at: string;
  card: { id: string; name: string; image_url: string; category: string; condition: string } | null;
  buyer: { id: string; display_name: string; email: string; profile_image_url: string | null } | null;
  seller: { id: string; display_name: string; email: string; profile_image_url: string | null; seller_verified: boolean; seller_rating: number } | null;
};

// Icons/colors are locale-independent; the labels live in the per-locale
// `copy.statusLabels` object inside the component (previously they were
// hardcoded Vietnamese for every locale).
const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  pending_payment: { icon: <Clock className="h-4 w-4" />, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  paid: { icon: <CheckCircle className="h-4 w-4" />, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  shipping: { icon: <Truck className="h-4 w-4" />, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  delivered: { icon: <Package className="h-4 w-4" />, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
  completed: { icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  disputed: { icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  refunded: { icon: <XCircle className="h-4 w-4" />, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
  cancelled: { icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground', bgColor: 'bg-muted/50' },
};

const TRACKING_STEP_KEYS = ['created', 'picked', 'transporting', 'delivering', 'delivered'] as const;

function getGHNStep(status: string | null): number {
  if (!status) return 0;
  const map: Record<string, number> = {
    ready_to_pick: 1, picking: 1,
    picked: 2, storing: 2,
    transporting: 3, sorting: 3,
    delivering: 4, money_collect_delivering: 4,
    delivered: 5,
  };
  return map[status] || 0;
}

export default function OrdersPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const router = useRouter();
  const copy = locale === 'ja-JP'
    ? {
        title: '注文管理',
        buyerOrders: '購入注文',
        sellerOrders: '販売注文',
        emptyTitle: '注文はまだありません',
        emptyBuyer: '欲しいカードを探しに購入ページへ進んでください。',
        emptySeller: '誰かがあなたのカードを購入すると、ここに表示されます。',
        missingSellerTitle: '発送元住所がありません',
        missingSellerDesc: '発送前にプロフィールで住所を更新してください。',
        success: '成功',
        updated: '注文が更新されました。',
        tracking: 'GHN tracking',
        openDispute: 'Open dispute',
        openDisputeDesc: 'Describe the reason. Admin will review and decide.',
        disputePlaceholder: 'Example: Fake card, not as described, damaged...',
        cancel: 'Cancel',
        submitDispute: 'Submit dispute',
        cancelOrder: 'Cancel order',
        shipOrder: '発送する',
        confirm: '確認',
        shipCountdownSeller: '追跡番号を入力する残り時間:',
        shipCountdownBuyer: '販売者の発送期限まで:',
        shipCountdownNoteBuyer: '期限超過で自動キャンセル・あなたのウォレットへ返金・販売者の評価減点。',
        shipCountdownNoteSeller: '期限超過で自動キャンセル・購入者へ返金・あなたの評価が減点されます。',
        shipExpired: '発送期限切れ — 自動キャンセル・返金されます。',
        trackGHN: 'Track GHN',
        received: 'Received item',
        dispute: 'Dispute',
        seller: 'Seller',
        buyer: 'Buyer',
        noCard: 'Unknown card',
        errorTitle: 'エラー',
        loadError: '注文を読み込めませんでした。',
        retry: '再試行',
        orderPrefix: '注文 #',
        shipFeeLabel: '+ 配送:',
        expectedLabel: '配達予定:',
        statusLabels: {
          pending_payment: '支払い待ち',
          paid: '支払い済み',
          shipping: '配送中',
          delivered: '配達済み',
          completed: '完了',
          disputed: '紛争中',
          refunded: '返金済み',
          cancelled: 'キャンセル済み',
        } as Record<string, string>,
        ghnStatusLabels: {
          ready_to_pick: '集荷待ち',
          picking: '集荷中',
          picked: '集荷済み',
          storing: '保管中',
          transporting: '輸送中',
          sorting: '仕分け中',
          delivering: '配達中',
          delivered: '配達済み',
          delivery_fail: '配達失敗',
          cancel: 'キャンセル',
          returning: '返送中',
          returned: '返送済み',
        } as Record<string, string>,
        trackingSteps: ['作成済み', '集荷済み', '輸送中', '配達中', '配達済み'],
      }
    : locale === 'vi-VN'
      ? {
          title: 'Quản lý đơn hàng',
          buyerOrders: 'Đơn mua',
          sellerOrders: 'Đơn bán',
          emptyTitle: 'Chưa có đơn hàng nào',
          emptyBuyer: 'Hãy đến trang Mua để tìm thẻ ưng ý!',
          emptySeller: 'Khi có người mua thẻ của bạn, đơn hàng sẽ hiện ở đây.',
          missingSellerTitle: 'Chưa có địa chỉ gửi hàng',
          missingSellerDesc: 'Vui lòng cập nhật địa chỉ trong Hồ sơ trước khi giao hàng.',
          success: 'Thành công',
          updated: 'Đơn hàng đã được cập nhật.',
          tracking: 'Theo dõi GHN',
          openDispute: 'Mở khiếu nại',
          openDisputeDesc: 'Mô tả lý do khiếu nại. Admin sẽ xem xét và phân xử.',
          disputePlaceholder: 'VD: Thẻ bị giả, không đúng mô tả, hư hỏng...',
          cancel: 'Hủy',
          submitDispute: 'Gửi khiếu nại',
          cancelOrder: 'Hủy đơn',
          shipOrder: 'Giao hàng',
          confirm: 'Xác nhận',
          shipCountdownSeller: 'Bạn cần cập nhật mã vận đơn trong',
          shipCountdownBuyer: 'Người bán cần giao hàng trong',
          shipCountdownNoteBuyer: 'Quá hạn: đơn tự huỷ, tiền hoàn về ví bạn, người bán bị trừ uy tín.',
          shipCountdownNoteSeller: 'Quá hạn: đơn tự huỷ, tiền hoàn cho người mua, bạn bị trừ điểm uy tín.',
          shipExpired: 'Quá hạn giao hàng — đơn sẽ tự huỷ & hoàn tiền.',
          trackGHN: 'Theo dõi GHN',
          received: 'Đã nhận hàng',
          dispute: 'Khiếu nại',
          seller: 'Người bán',
          buyer: 'Người mua',
          noCard: 'Thẻ không xác định',
          errorTitle: 'Lỗi',
          loadError: 'Không thể tải danh sách đơn hàng.',
          retry: 'Thử lại',
          orderPrefix: 'Đơn #',
          shipFeeLabel: '+ Ship:',
          expectedLabel: 'Dự kiến:',
          statusLabels: {
            pending_payment: 'Chờ thanh toán',
            paid: 'Đã thanh toán',
            shipping: 'Đang vận chuyển',
            delivered: 'Đã giao',
            completed: 'Hoàn tất',
            disputed: 'Khiếu nại',
            refunded: 'Đã hoàn tiền',
            cancelled: 'Đã hủy',
          } as Record<string, string>,
          ghnStatusLabels: {
            ready_to_pick: 'Chờ lấy hàng',
            picking: 'Đang lấy hàng',
            picked: 'Đã lấy hàng',
            storing: 'Đang lưu kho',
            transporting: 'Đang vận chuyển',
            sorting: 'Đang phân loại',
            delivering: 'Đang giao hàng',
            delivered: 'Đã giao hàng',
            delivery_fail: 'Giao thất bại',
            cancel: 'Đã hủy',
            returning: 'Đang trả hàng',
            returned: 'Đã hoàn',
          } as Record<string, string>,
          trackingSteps: ['Đã tạo đơn', 'Đã lấy hàng', 'Vận chuyển', 'Đang giao', 'Đã giao'],
        }
      : {
          title: 'Order management',
          buyerOrders: 'Buying orders',
          sellerOrders: 'Selling orders',
          emptyTitle: 'No orders yet',
          emptyBuyer: 'Go to the Buy page to find a card you like.',
          emptySeller: 'When someone buys your card, the order will appear here.',
          missingSellerTitle: 'Missing shipping origin address',
          missingSellerDesc: 'Please update your address in Profile before shipping.',
          success: 'Success',
          updated: 'The order has been updated.',
          tracking: 'GHN tracking',
          openDispute: 'Open dispute',
          openDisputeDesc: 'Describe the dispute reason. Admin will review and decide.',
          disputePlaceholder: 'Example: Fake card, not as described, damaged...',
          cancel: 'Cancel',
          submitDispute: 'Submit dispute',
          cancelOrder: 'Cancel order',
          shipOrder: 'Ship order',
          confirm: 'Confirm',
          shipCountdownSeller: 'You must upload tracking within',
          shipCountdownBuyer: 'The seller must ship within',
          shipCountdownNoteBuyer: 'If overdue: the order auto-cancels, is refunded to your wallet, and the seller loses reputation.',
          shipCountdownNoteSeller: 'If overdue: the order auto-cancels, the buyer is refunded, and you lose reputation.',
          shipExpired: 'Overdue — the order will auto-cancel and refund.',
          trackGHN: 'Track GHN',
          received: 'Item received',
          dispute: 'Dispute',
          seller: 'Seller',
          buyer: 'Buyer',
          noCard: 'Unknown card',
          errorTitle: 'Error',
          loadError: 'Unable to load orders.',
          retry: 'Retry',
          orderPrefix: 'Order #',
          shipFeeLabel: '+ Shipping:',
          expectedLabel: 'Expected:',
          statusLabels: {
            pending_payment: 'Awaiting payment',
            paid: 'Paid',
            shipping: 'Shipping',
            delivered: 'Delivered',
            completed: 'Completed',
            disputed: 'Disputed',
            refunded: 'Refunded',
            cancelled: 'Cancelled',
          } as Record<string, string>,
          ghnStatusLabels: {
            ready_to_pick: 'Awaiting pickup',
            picking: 'Picking up',
            picked: 'Picked up',
            storing: 'In warehouse',
            transporting: 'In transit',
            sorting: 'Sorting',
            delivering: 'Out for delivery',
            delivered: 'Delivered',
            delivery_fail: 'Delivery failed',
            cancel: 'Cancelled',
            returning: 'Returning',
            returned: 'Returned',
          } as Record<string, string>,
          trackingSteps: ['Created', 'Picked up', 'In transit', 'Delivering', 'Delivered'],
        };
  const [activeTab, setActiveTab] = useState('buyer');
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Dispute dialog
  const [disputeDialog, setDisputeDialog] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: '' });
  const [disputeReason, setDisputeReason] = useState('');
  // Ship dialog — seller picks carrier + uploads tracking number
  const [shipDialog, setShipDialog] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: '' });
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTracking, setShipTracking] = useState('');
  // Generic confirm dialog for lifecycle actions (confirm received / cancel).
  const [confirmAction, setConfirmAction] = useState<{ orderId: string; action: string; title: string; message: string } | null>(null);

  // Live clock for the 24h ship-deadline countdown.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tracking dialog
  const [trackingDialog, setTrackingDialog] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

  const fetchOrders = useCallback(async (role: string) => {
    setIsLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/marketplace/orders?role=${role}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.loadError);
      setOrders(data.orders || []);
    } catch (err: unknown) {
      console.error('Failed to fetch orders:', err);
      setLoadError(err instanceof Error ? err.message : copy.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    if (user) fetchOrders(activeTab);
  }, [user, activeTab, fetchOrders]);

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const handleAction = async (orderId: string, action: string, extra?: Record<string, string>) => {
    setActionLoading(orderId);
    try {
      const res = await fetch('/api/marketplace/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, action, ...extra }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Handle missing seller address
        if (data.code === 'MISSING_SELLER_ADDRESS') {
          toast({
            variant: 'destructive',
            title: copy.missingSellerTitle,
            description: copy.missingSellerDesc,
          });
          return;
        }
        throw new Error(data.error);
      }

      toast({ title: copy.success, description: copy.updated });
      setShipDialog({ open: false, orderId: '' });
      fetchOrders(activeTab);
    } catch (err: any) {
      toast({ variant: 'destructive', title: copy.errorTitle, description: err.message });
    } finally {
      setActionLoading(null);
      setDisputeDialog({ open: false, orderId: '' });
      setDisputeReason('');
    }
  };

  const renderTrackingStepper = (order: Order) => {
    if (!order.ghn_order_code) return null;
    const currentStep = getGHNStep(order.ghn_status);

    return (
      <div className="mt-3 p-3 rounded-lg bg-accent/30 border border-border/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.tracking}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {copy.ghnStatusLabels[order.ghn_status || ''] || order.ghn_status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {TRACKING_STEP_KEYS.map((key, i) => (
            <div key={key} className="flex-1 flex flex-col items-center">
              <div className={`w-full h-1.5 rounded-full transition-colors ${
                i < currentStep ? 'bg-green-500' :
                i === currentStep ? 'bg-yellow-400 animate-pulse' :
                'bg-white/10'
              }`} />
              <span className={`text-[10px] mt-1 ${i <= currentStep ? 'text-white/70' : 'text-white/30'}`}>
                {copy.trackingSteps[i]}
              </span>
            </div>
          ))}
        </div>
        {order.ghn_expected_delivery && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {copy.expectedLabel} {new Date(order.ghn_expected_delivery).toLocaleDateString(locale)}
          </p>
        )}
      </div>
    );
  };

  const renderOrderCard = (order: Order) => {
    const statusInfo = STATUS_CONFIG[order.status] || { icon: null, color: '', bgColor: '' };
    const statusLabel = copy.statusLabels[order.status] || order.status;
    const isBuyer = activeTab === 'buyer';

    return (
      <Card
        key={order.id}
        onClick={() => router.push(`/orders/${order.id}`)}
        className="cursor-pointer overflow-hidden transition-colors hover:border-orange-500/50"
      >
        <div className={`h-1 ${order.status === 'completed' ? 'bg-green-500' : order.status === 'disputed' ? 'bg-red-500' : 'bg-orange-500'}`} />
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Card Image */}
            {order.card?.image_url && (
              <div className="relative w-20 h-28 rounded-lg overflow-hidden flex-shrink-0">
                <Image src={order.card.image_url} alt="" fill className="object-cover" />
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold line-clamp-1">{order.card?.name || copy.noCard}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {copy.orderPrefix}{order.id.substring(0, 8)} • {new Date(order.created_at).toLocaleDateString(locale)}
                  </p>
                </div>
                <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
                  {statusInfo.icon} {statusLabel}
                </span>
              </div>

              <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                <span className="font-semibold text-orange-400">{formatVND(order.amount)}</span>
                {order.shipping_fee > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {copy.shipFeeLabel} <span className="text-foreground">{formatVND(order.shipping_fee)}</span>
                  </span>
                )}
                {order.ghn_order_code && (
                  <span className="text-xs text-blue-400 font-mono">
                    GHN: {order.ghn_order_code}
                  </span>
                )}
                {!order.ghn_order_code && order.tracking_number && (() => {
                  const url = getTrackingUrl(order.shipping_provider, order.tracking_number);
                  return url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs font-medium text-orange-400 underline underline-offset-2 hover:text-orange-300"
                    >
                      {order.shipping_provider?.toUpperCase()}: {order.tracking_number} ↗
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Tracking: <span className="text-foreground">{order.tracking_number}</span>
                    </span>
                  );
                })()}
              </div>

              {/* Shipping address (for seller view) */}
              {!isBuyer && order.to_address_detail && (
                <div className="flex items-start gap-1.5 mt-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-1">
                    {order.to_name} • {order.to_address_detail}, {order.to_ward_name}, {order.to_district_name}, {order.to_province_name}
                  </span>
                </div>
              )}

              {/* Counterparty info */}
              <p className="text-xs text-muted-foreground mt-1">
                {isBuyer ? `${copy.seller}: ${order.seller?.display_name || order.seller?.email || '—'}` : `${copy.buyer}: ${order.buyer?.display_name || order.buyer?.email || '—'}`}
              </p>

              {/* 24h ship-deadline countdown (paid, not yet shipped) */}
              {order.status === 'paid' && (() => {
                // Older orders (created before the ship_deadline column) fall back
                // to created_at + 24h so the countdown still shows.
                const deadlineTs = order.ship_deadline
                  ? new Date(order.ship_deadline).getTime()
                  : new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000;
                const remaining = deadlineTs - nowTs;
                if (remaining <= 0) {
                  return (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{copy.shipExpired}</span>
                    </div>
                  );
                }
                const h = Math.floor(remaining / 3600000);
                const m = Math.floor((remaining % 3600000) / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                return (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {isBuyer ? copy.shipCountdownBuyer : copy.shipCountdownSeller}{' '}
                      <b className="tabular-nums">{h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s</b>. {isBuyer ? copy.shipCountdownNoteBuyer : copy.shipCountdownNoteSeller}
                    </span>
                  </div>
                );
              })()}

              {/* GHN Tracking Stepper */}
              {(order.status === 'shipping' || order.status === 'delivered') && renderTrackingStepper(order)}

              {/* Actions */}
              <div className="flex gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
                {/* Seller: create shipment + upload tracking */}
                {!isBuyer && order.status === 'paid' && (
                  <Button
                    size="sm"
                    onClick={() => { setShipCarrier(order.metadata?.shipping_carrier || ''); setShipTracking(''); setShipDialog({ open: true, orderId: order.id }); }}
                    disabled={actionLoading === order.id}
                    className="bg-orange-500 hover:bg-orange-600"
                  >
                    <Truck className="h-3 w-3 mr-1" />
                    {copy.shipOrder}
                  </Button>
                )}

                {/* Seller: confirm delivered on a lazy buyer's behalf, only after
                    est. delivery + 3 days from ship time (part 4) */}
                {!isBuyer && ['shipping', 'delivered'].includes(order.status) && (() => {
                  const maxDays = getDeliveryDays(order.metadata?.shipping_carrier || order.shipping_provider)?.max ?? 5;
                  const shippedAt = order.auto_complete_at ? new Date(order.auto_complete_at).getTime() - 72 * 3600 * 1000 : new Date(order.updated_at).getTime();
                  const canConfirm = nowTs >= shippedAt + (maxDays + 3) * 24 * 3600 * 1000;
                  if (!canConfirm) return null;
                  return (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      disabled={actionLoading === order.id}
                      onClick={() => setConfirmAction({
                        orderId: order.id,
                        action: 'confirm_received',
                        title: locale === 'ja-JP' ? '配達完了を確認しますか？' : locale === 'en-US' ? 'Confirm delivered?' : 'Xác nhận đã giao thành công?',
                        message: locale === 'ja-JP' ? '購入者が受け取ったことを確認できる場合のみ実行してください。' : locale === 'en-US' ? 'Only confirm if you are sure the buyer received the item.' : 'Chỉ xác nhận khi bạn chắc chắn người mua đã nhận hàng.',
                      })}
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {locale === 'ja-JP' ? '配達完了' : locale === 'en-US' ? 'Delivered' : 'Đã giao thành công'}
                    </Button>
                  );
                })()}

                {/* Track on GHN */}
                {order.ghn_order_code && ['shipping', 'delivered'].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`https://tracking.ghn.dev/?order_code=${order.ghn_order_code}`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    {copy.trackGHN}
                  </Button>
                )}

                {/* Buyer actions */}
                {isBuyer && ['shipping', 'delivered'].includes(order.status) && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setConfirmAction({
                        orderId: order.id,
                        action: 'confirm_received',
                        title: locale === 'ja-JP' ? '受け取りを確認しますか？' : locale === 'en-US' ? 'Confirm receipt?' : 'Xác nhận đã nhận hàng?',
                        message: locale === 'ja-JP' ? '代金が販売者に支払われます。商品を受け取ってから確認してください。' : locale === 'en-US' ? 'Funds will be released to the seller. Only confirm once you have received the item.' : 'Tiền sẽ được chuyển cho người bán. Chỉ xác nhận khi bạn đã nhận đúng hàng.',
                      })}
                      disabled={actionLoading === order.id}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {actionLoading === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                      {copy.received}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDisputeDialog({ open: true, orderId: order.id })}
                      disabled={actionLoading === order.id}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {copy.dispute}
                    </Button>
                  </>
                )}

                {/* Cancel */}
                {['pending_payment', 'paid'].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmAction({
                      orderId: order.id,
                      action: 'cancel',
                      title: locale === 'ja-JP' ? '注文をキャンセルしますか？' : locale === 'en-US' ? 'Cancel this order?' : 'Huỷ đơn hàng này?',
                      message: order.status === 'paid'
                        ? (locale === 'ja-JP' ? '注文がキャンセルされ、代金はウォレットに返金されます。' : locale === 'en-US' ? 'The order will be cancelled and refunded to the wallet.' : 'Đơn sẽ bị huỷ và tiền hoàn về ví.')
                        : (locale === 'ja-JP' ? '注文がキャンセルされます。' : locale === 'en-US' ? 'The order will be cancelled.' : 'Đơn hàng sẽ bị huỷ.'),
                    })}
                    disabled={actionLoading === order.id}
                  >
                    {copy.cancelOrder}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8">
          <Skeleton className="h-[400px] w-full max-w-4xl mx-auto rounded-xl" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <h1 className="text-3xl font-bold" style={{ fontFamily: "'Orbitron', sans-serif" }}>
            {copy.title}
          </h1>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 max-w-sm">
              <TabsTrigger value="buyer" className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                {copy.buyerOrders}
              </TabsTrigger>
              <TabsTrigger value="seller" className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                {copy.sellerOrders}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center rounded-xl border border-red-500/30 bg-red-500/10 py-12 text-center">
                  <AlertTriangle className="mb-3 h-10 w-10 text-red-400" />
                  <p className="font-medium text-red-300">{loadError}</p>
                  <Button variant="outline" className="mt-4" onClick={() => void fetchOrders(activeTab)}>
                    {copy.retry}
                  </Button>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-xl font-semibold">{copy.emptyTitle}</p>
                  <p className="text-muted-foreground mt-1">
                    {activeTab === 'buyer' ? copy.emptyBuyer : copy.emptySeller}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map(renderOrderCard)}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />

      {/* Generic confirm dialog (confirm received / cancel) */}
      <Dialog open={!!confirmAction} onOpenChange={o => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.title}</DialogTitle>
            <DialogDescription>{confirmAction?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={actionLoading === confirmAction?.orderId}>{copy.cancel}</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              disabled={actionLoading === confirmAction?.orderId}
              onClick={() => {
                if (!confirmAction) return;
                const { orderId, action } = confirmAction;
                setConfirmAction(null);
                void handleAction(orderId, action);
              }}
            >
              {actionLoading === confirmAction?.orderId ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ship Dialog */}
      <Dialog open={shipDialog.open} onOpenChange={open => setShipDialog({ ...shipDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === 'ja-JP' ? '追跡番号を入力' : locale === 'en-US' ? 'Enter tracking number' : 'Nhập mã vận đơn'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'ja-JP'
                ? '追跡番号を入力すると、購入者にメールで通知されます。'
                : locale === 'en-US'
                  ? 'Enter the tracking number — the buyer will be notified by email.'
                  : 'Nhập mã vận đơn để giao hàng. Người mua sẽ nhận email thông báo.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {shipCarrier ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {locale === 'ja-JP' ? '配送業者（購入者が選択）' : locale === 'en-US' ? 'Carrier (chosen by buyer)' : 'Đơn vị vận chuyển (người mua đã chọn)'}
                </p>
                {(() => {
                  const c = getCarrier(shipCarrier);
                  return (
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                      {c?.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.logo} alt="" className="h-5 w-5 rounded" />
                      ) : (
                        <Truck className="h-4 w-4" />
                      )}
                      {c?.name || shipCarrier}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {locale === 'ja-JP' ? '配送業者' : locale === 'en-US' ? 'Carrier' : 'Đơn vị vận chuyển'}
                </p>
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
            {shipCarrier && shipCarrier !== 'self' && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {locale === 'ja-JP' ? '追跡番号' : locale === 'en-US' ? 'Tracking number' : 'Mã vận đơn'}
                </p>
                <Input
                  value={shipTracking}
                  onChange={e => setShipTracking(e.target.value)}
                  placeholder={locale === 'ja-JP' ? '例: LWtxxxxxxx' : locale === 'en-US' ? 'e.g. LWtxxxxxxx' : 'VD: LWtxxxxxxx'}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipDialog({ open: false, orderId: '' })}>{copy.cancel}</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => handleAction(shipDialog.orderId, 'ship', { shipping_provider: shipCarrier, tracking_number: shipTracking.trim() })}
              disabled={!shipCarrier || (shipCarrier !== 'self' && !shipTracking.trim()) || actionLoading === shipDialog.orderId}
            >
              {actionLoading === shipDialog.orderId ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.shipOrder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disputeDialog.open} onOpenChange={open => setDisputeDialog({ ...disputeDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.openDispute}</DialogTitle>
            <DialogDescription>{copy.openDisputeDesc}</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={copy.disputePlaceholder}
            value={disputeReason}
            onChange={e => setDisputeReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialog({ open: false, orderId: '' })}>{copy.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() => handleAction(disputeDialog.orderId, 'dispute', { dispute_reason: disputeReason })}
              disabled={!disputeReason || actionLoading === disputeDialog.orderId}
            >
              {actionLoading === disputeDialog.orderId ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.submitDispute}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
