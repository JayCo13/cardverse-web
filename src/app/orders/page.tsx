
'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  pending_payment: { label: 'Chờ thanh toán', icon: <Clock className="h-4 w-4" />, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  paid: { label: 'Đã thanh toán', icon: <CheckCircle className="h-4 w-4" />, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  shipping: { label: 'Đang vận chuyển', icon: <Truck className="h-4 w-4" />, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  delivered: { label: 'Đã giao', icon: <Package className="h-4 w-4" />, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
  completed: { label: 'Hoàn tất', icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  disputed: { label: 'Khiếu nại', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  refunded: { label: 'Đã hoàn tiền', icon: <XCircle className="h-4 w-4" />, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
  cancelled: { label: 'Đã hủy', icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground', bgColor: 'bg-muted/50' },
};

const GHN_STATUS_LABELS: Record<string, string> = {
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
};

const TRACKING_STEPS = [
  { key: 'created', label: 'Đã tạo đơn' },
  { key: 'picked', label: 'Đã lấy hàng' },
  { key: 'transporting', label: 'Vận chuyển' },
  { key: 'delivering', label: 'Đang giao' },
  { key: 'delivered', label: 'Đã giao' },
];

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
  const [activeTab, setActiveTab] = useState('buyer');
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Dispute dialog
  const [disputeDialog, setDisputeDialog] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: '' });
  const [disputeReason, setDisputeReason] = useState('');

  // Tracking dialog
  const [trackingDialog, setTrackingDialog] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

  const fetchOrders = useCallback(async (role: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/marketplace/orders?role=${role}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
            title: 'Chưa có địa chỉ gửi hàng',
            description: 'Vui lòng cập nhật địa chỉ trong Hồ sơ trước khi giao hàng.',
          });
          return;
        }
        throw new Error(data.error);
      }

      toast({ title: '✅ Thành công', description: 'Đơn hàng đã được cập nhật.' });
      fetchOrders(activeTab);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message });
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
          <span className="text-xs font-medium text-muted-foreground">Theo dõi GHN</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {GHN_STATUS_LABELS[order.ghn_status || ''] || order.ghn_status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {TRACKING_STEPS.map((step, i) => (
            <div key={step.key} className="flex-1 flex flex-col items-center">
              <div className={`w-full h-1.5 rounded-full transition-colors ${
                i < currentStep ? 'bg-green-500' :
                i === currentStep ? 'bg-yellow-400 animate-pulse' :
                'bg-white/10'
              }`} />
              <span className={`text-[8px] mt-1 ${i <= currentStep ? 'text-white/70' : 'text-white/30'}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
        {order.ghn_expected_delivery && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Dự kiến: {new Date(order.ghn_expected_delivery).toLocaleDateString('vi-VN')}
          </p>
        )}
      </div>
    );
  };

  const renderOrderCard = (order: Order) => {
    const statusInfo = STATUS_CONFIG[order.status] || { label: order.status, icon: null, color: '', bgColor: '' };
    const isBuyer = activeTab === 'buyer';

    return (
      <Card key={order.id} className="overflow-hidden">
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
                  <h3 className="font-semibold line-clamp-1">{order.card?.name || 'Thẻ không xác định'}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Đơn #{order.id.substring(0, 8)} • {new Date(order.created_at).toLocaleDateString('vi-VN')}
                  </p>
                </div>
                <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
              </div>

              <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                <span className="font-semibold text-orange-400">{formatVND(order.amount)}</span>
                {order.shipping_fee > 0 && (
                  <span className="text-xs text-muted-foreground">
                    + Ship: <span className="text-foreground">{formatVND(order.shipping_fee)}</span>
                  </span>
                )}
                {order.ghn_order_code && (
                  <span className="text-xs text-blue-400 font-mono">
                    GHN: {order.ghn_order_code}
                  </span>
                )}
                {!order.ghn_order_code && order.tracking_number && (
                  <span className="text-xs text-muted-foreground">
                    Tracking: <span className="text-foreground">{order.tracking_number}</span>
                  </span>
                )}
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
                {isBuyer ? `Người bán: ${order.seller?.display_name || order.seller?.email || '—'}` : `Người mua: ${order.buyer?.display_name || order.buyer?.email || '—'}`}
              </p>

              {/* GHN Tracking Stepper */}
              {(order.status === 'shipping' || order.status === 'delivered') && renderTrackingStepper(order)}

              {/* Actions */}
              <div className="flex gap-2 mt-3 flex-wrap">
                {/* Seller: Ship with GHN (1-click) */}
                {!isBuyer && order.status === 'paid' && (
                  <Button
                    size="sm"
                    onClick={() => handleAction(order.id, 'ship')}
                    disabled={actionLoading === order.id}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {actionLoading === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Truck className="h-3 w-3 mr-1" />}
                    Tạo đơn GHN & Gửi hàng
                  </Button>
                )}

                {/* Track on GHN */}
                {order.ghn_order_code && ['shipping', 'delivered'].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`https://tracking.ghn.dev/?order_code=${order.ghn_order_code}`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Theo dõi GHN
                  </Button>
                )}

                {/* Buyer actions */}
                {isBuyer && ['shipping', 'delivered'].includes(order.status) && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleAction(order.id, 'confirm_received')}
                      disabled={actionLoading === order.id}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {actionLoading === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                      Đã nhận hàng
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDisputeDialog({ open: true, orderId: order.id })}
                      disabled={actionLoading === order.id}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Khiếu nại
                    </Button>
                  </>
                )}

                {/* Cancel */}
                {['pending_payment', 'paid'].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(order.id, 'cancel')}
                    disabled={actionLoading === order.id}
                  >
                    Hủy đơn
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
            Quản lý đơn hàng
          </h1>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 max-w-sm">
              <TabsTrigger value="buyer" className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Đơn mua
              </TabsTrigger>
              <TabsTrigger value="seller" className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                Đơn bán
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-xl font-semibold">Chưa có đơn hàng nào</p>
                  <p className="text-muted-foreground mt-1">
                    {activeTab === 'buyer' ? 'Hãy đến trang Mua để tìm thẻ ưng ý!' : 'Khi có người mua thẻ của bạn, đơn hàng sẽ hiện ở đây.'}
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

      {/* Dispute Dialog */}
      <Dialog open={disputeDialog.open} onOpenChange={open => setDisputeDialog({ ...disputeDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mở khiếu nại</DialogTitle>
            <DialogDescription>Mô tả lý do khiếu nại. Admin sẽ xem xét và phân xử.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="VD: Thẻ bị giả, không đúng mô tả, hư hỏng..."
            value={disputeReason}
            onChange={e => setDisputeReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialog({ open: false, orderId: '' })}>Hủy</Button>
            <Button
              variant="destructive"
              onClick={() => handleAction(disputeDialog.orderId, 'dispute', { dispute_reason: disputeReason })}
              disabled={!disputeReason || actionLoading === disputeDialog.orderId}
            >
              {actionLoading === disputeDialog.orderId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gửi khiếu nại'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
