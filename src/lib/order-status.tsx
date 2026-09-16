import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle, Clock, Package, Truck, XCircle } from 'lucide-react';

type StatusCopy = { vi: string; en: string; ja: string };

const ORDER_STATUS_LABELS: Record<string, StatusCopy> = {
  pending_payment: { vi: 'Chờ thanh toán', en: 'Awaiting payment', ja: '支払い待ち' },
  paid: { vi: 'Đã thanh toán', en: 'Paid', ja: '支払い済み' },
  shipping: { vi: 'Đang vận chuyển', en: 'Shipping', ja: '配送中' },
  delivered: { vi: 'Đã giao', en: 'Delivered', ja: '配達済み' },
  completed: { vi: 'Hoàn tất', en: 'Completed', ja: '完了' },
  disputed: { vi: 'Khiếu nại', en: 'Disputed', ja: '紛争中' },
  refunded: { vi: 'Đã hoàn tiền', en: 'Refunded', ja: '返金済み' },
  cancelled: { vi: 'Đã hủy', en: 'Cancelled', ja: 'キャンセル済み' },
};

export const ORDER_STATUS_CONFIG: Record<string, { icon: ReactNode; color: string; bgColor: string }> = {
  pending_payment: { icon: <Clock className="h-4 w-4" />, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  paid: { icon: <CheckCircle className="h-4 w-4" />, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  shipping: { icon: <Truck className="h-4 w-4" />, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  delivered: { icon: <Package className="h-4 w-4" />, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
  completed: { icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  disputed: { icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  refunded: { icon: <XCircle className="h-4 w-4" />, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
  cancelled: { icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground', bgColor: 'bg-muted/50' },
};

export function orderStatusLabel(status: string, locale: string): string {
  const entry = ORDER_STATUS_LABELS[status];
  if (!entry) return status;
  return entry[locale === 'ja-JP' ? 'ja' : locale === 'en-US' ? 'en' : 'vi'];
}
