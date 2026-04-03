
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, CreditCard, Loader2, CheckCircle, ShieldCheck, ExternalLink, Truck } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { AddressPicker, type AddressData } from '@/components/address-picker';
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
  sellerAddress?: {
    districtId: number;
    wardCode: string;
  } | null;
};

export function CheckoutModal({ open, onOpenChange, card, onSuccess, sellerAddress }: CheckoutModalProps) {
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'direct_payos'>('wallet');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);

  // Shipping
  const [buyerAddress, setBuyerAddress] = useState<AddressData | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [shippingFee, setShippingFee] = useState<number | null>(null);
  const [loadingFee, setLoadingFee] = useState(false);
  const [feeError, setFeeError] = useState('');

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

  // Calculate shipping fee when buyer selects address
  const calculateFee = useCallback(async (address: AddressData | null) => {
    setBuyerAddress(address);
    setShippingFee(null);
    setFeeError('');

    if (!address || !sellerAddress) {
      return;
    }

    setLoadingFee(true);
    try {
      const params = new URLSearchParams({
        from_district_id: sellerAddress.districtId.toString(),
        from_ward_code: sellerAddress.wardCode,
        to_district_id: address.districtId.toString(),
        to_ward_code: address.wardCode,
        insurance_value: card ? card.price.toString() : '0',
      });

      const res = await fetch(`/api/shipping/fee?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setShippingFee(data.shipping_fee);
    } catch (err: any) {
      console.error('Fee calculation error:', err);
      setFeeError('Không thể tính phí ship. Vui lòng thử lại.');
    } finally {
      setLoadingFee(false);
    }
  }, [sellerAddress, card]);

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const totalAmount = (card?.price || 0) + (shippingFee || 0);
  const insufficientBalance = walletBalance < totalAmount;

  const canPurchase = buyerAddress && buyerName.trim() && buyerPhone.trim() && shippingFee !== null && !loadingFee;

  const handlePurchase = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card || !buyerAddress || !canPurchase) return;

    setIsPurchasing(true);
    try {
      const res = await fetch('/api/marketplace/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card.id,
          payment_method: paymentMethod,
          shipping_fee: shippingFee,
          to_name: buyerName,
          to_phone: buyerPhone,
          to_district_id: buyerAddress.districtId,
          to_district_name: buyerAddress.districtName,
          to_province_id: buyerAddress.provinceId,
          to_province_name: buyerAddress.provinceName,
          to_ward_code: buyerAddress.wardCode,
          to_ward_name: buyerAddress.wardName,
          to_address_detail: buyerAddress.detail,
          shipping_address: `${buyerAddress.detail}, ${buyerAddress.wardName}, ${buyerAddress.districtName}, ${buyerAddress.provinceName}`,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      if (data.payment_method === 'direct_payos' && data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank');
        toast({
          title: 'Đang chuyển hướng...',
          description: 'Vui lòng hoàn tất thanh toán trên trang PayOS.',
        });
      } else {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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

          {/* Buyer Info */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Thông tin nhận hàng</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={buyerName}
                onChange={e => setBuyerName(e.target.value)}
                placeholder="Tên người nhận"
                className="h-9 text-sm"
              />
              <Input
                value={buyerPhone}
                onChange={e => setBuyerPhone(e.target.value)}
                placeholder="Số điện thoại"
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Shipping Address */}
          <AddressPicker
            label="Địa chỉ nhận hàng"
            onChange={calculateFee}
            detailPlaceholder="Số nhà, tên đường..."
          />

          {/* Shipping Fee */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/30 border border-border/50">
            <div className="flex items-center gap-2 text-sm">
              <Truck className="h-4 w-4 text-blue-400" />
              <span className="text-muted-foreground">Phí vận chuyển (GHN):</span>
            </div>
            <div>
              {loadingFee ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : shippingFee !== null ? (
                <span className="font-semibold text-sm">{formatVND(shippingFee)}</span>
              ) : feeError ? (
                <span className="text-xs text-red-400">{feeError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">Chọn địa chỉ để tính</span>
              )}
            </div>
          </div>

          {/* Total */}
          {shippingFee !== null && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <span className="font-semibold text-sm">Tổng thanh toán:</span>
              <span className="text-lg font-bold text-orange-400">{formatVND(totalAmount)}</span>
            </div>
          )}

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
              Số dư ví không đủ. Bạn cần thêm {formatVND(totalAmount - walletBalance)}.
              <Button variant="link" size="sm" className="text-orange-400 p-0 h-auto ml-1" asChild>
                <a href="/wallet" target="_blank">Nạp tiền ngay <ExternalLink className="h-3 w-3 ml-1" /></a>
              </Button>
            </div>
          )}

          {/* Missing seller address warning */}
          {!sellerAddress && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
              ⚠️ Người bán chưa cập nhật địa chỉ gửi hàng. Phí ship sẽ được tính sau khi đặt hàng.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button
            onClick={handlePurchase}
            disabled={isPurchasing || !canPurchase || (paymentMethod === 'wallet' && insufficientBalance)}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold"
          >
            {isPurchasing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            {shippingFee !== null
              ? `Thanh toán ${formatVND(totalAmount)}`
              : paymentMethod === 'wallet'
                ? 'Chọn địa chỉ trước'
                : 'Thanh toán qua PayOS'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
