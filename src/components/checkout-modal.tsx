
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, CreditCard, Loader2, CheckCircle, ShieldCheck, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

type Card = {
  id: string;
  name: string;
  image_url: string;
  price: number;
  category: string;
  condition: string;
  seller_id: string;
};

type CheckoutModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
  onSuccess?: () => void;
};

export function CheckoutModal({ open, onOpenChange, card, onSuccess }: CheckoutModalProps) {
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'direct_payos'>('wallet');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [shippingAddress, setShippingAddress] = useState('');

  useEffect(() => {
    if (open && user) {
      fetchWalletBalance();
    }
  }, [open, user]);

  const fetchWalletBalance = async () => {
    setIsLoadingWallet(true);
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      setWalletBalance(data.wallet?.available_balance || 0);
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
    } finally {
      setIsLoadingWallet(false);
    }
  };

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const handlePurchase = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card) return;

    setIsPurchasing(true);
    try {
      const res = await fetch('/api/marketplace/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card.id,
          payment_method: paymentMethod,
          shipping_address: shippingAddress,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      if (data.payment_method === 'direct_payos' && data.checkoutUrl) {
        // Redirect to PayOS checkout
        window.open(data.checkoutUrl, '_blank');
        toast({
          title: 'Đang chuyển hướng...',
          description: 'Vui lòng hoàn tất thanh toán trên trang PayOS.',
        });
      } else {
        // Wallet payment success
        toast({
          title: '🎉 Mua thành công!',
          description: `Bạn đã mua "${card.name}". Xem đơn hàng tại trang Quản lý đơn hàng.`,
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message });
    } finally {
      setIsPurchasing(false);
    }
  };

  if (!card) return null;

  const insufficientBalance = walletBalance < card.price;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-orange-500" />
            Thanh toán an toàn
          </DialogTitle>
          <DialogDescription>Xác nhận mua thẻ và chọn phương thức thanh toán</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Card Summary */}
          <div className="flex gap-3 p-3 rounded-lg bg-accent/50">
            {card.image_url && (
              <div className="relative w-16 h-22 rounded overflow-hidden flex-shrink-0">
                <Image src={card.image_url} alt="" width={64} height={88} className="object-cover rounded" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold line-clamp-2 text-sm">{card.name}</p>
              <p className="text-xs text-muted-foreground">{card.category} • {card.condition}</p>
              <p className="text-lg font-bold text-orange-500 mt-1">{formatVND(card.price)}</p>
            </div>
          </div>

          {/* Shipping Address */}
          <div>
            <Label htmlFor="address" className="text-sm">Địa chỉ nhận hàng</Label>
            <Input
              id="address"
              value={shippingAddress}
              onChange={e => setShippingAddress(e.target.value)}
              placeholder="Nhập địa chỉ nhận hàng của bạn..."
            />
          </div>

          {/* Payment Method */}
          <div>
            <Label className="text-sm font-medium">Phương thức thanh toán</Label>
            <RadioGroup value={paymentMethod} onValueChange={v => setPaymentMethod(v as 'wallet' | 'direct_payos')} className="mt-2 space-y-2">
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === 'wallet' ? 'border-orange-500 bg-orange-500/5' : 'hover:bg-accent/50'}`}>
                <RadioGroupItem value="wallet" id="wallet" />
                <Wallet className="h-5 w-5 text-orange-500" />
                <div className="flex-1">
                  <p className="font-medium text-sm">Ví Cardverse</p>
                  <p className={`text-xs ${insufficientBalance ? 'text-red-400' : 'text-green-400'}`}>
                    Số dư: {isLoadingWallet ? '...' : formatVND(walletBalance)}
                    {insufficientBalance && !isLoadingWallet && ' (Không đủ)'}
                  </p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === 'direct_payos' ? 'border-orange-500 bg-orange-500/5' : 'hover:bg-accent/50'}`}>
                <RadioGroupItem value="direct_payos" id="direct" />
                <CreditCard className="h-5 w-5 text-blue-500" />
                <div className="flex-1">
                  <p className="font-medium text-sm">Chuyển khoản / QR (PayOS)</p>
                  <p className="text-xs text-muted-foreground">Thanh toán trực tiếp qua ngân hàng</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Insufficient balance warning */}
          {paymentMethod === 'wallet' && insufficientBalance && !isLoadingWallet && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
              Số dư ví không đủ. Bạn cần thêm {formatVND(card.price - walletBalance)}.
              <Button variant="link" size="sm" className="text-orange-400 p-0 h-auto ml-1" asChild>
                <a href="/wallet" target="_blank">Nạp tiền ngay <ExternalLink className="h-3 w-3 ml-1" /></a>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button
            onClick={handlePurchase}
            disabled={isPurchasing || (paymentMethod === 'wallet' && insufficientBalance)}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold"
          >
            {isPurchasing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            {paymentMethod === 'wallet' ? `Thanh toán ${formatVND(card.price)}` : `Thanh toán qua PayOS`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
