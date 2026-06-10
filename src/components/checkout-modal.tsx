
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, CreditCard, Loader2, CheckCircle, ShieldCheck, ExternalLink, Truck } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { AddressBook, type SavedAddress } from '@/components/address-book';
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

  // Shipping — address comes from the buyer's TikTok-style address book.
  const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
  const [shippingFee, setShippingFee] = useState<number | null>(null);
  const [loadingFee, setLoadingFee] = useState(false);
  const [feeError, setFeeError] = useState('');
  const userId = user?.id ?? null;

  useEffect(() => {
    if (open && userId) {
      fetchWalletBalance();
    }
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    setSelectedAddress(null);
    setShippingFee(null);
    setFeeError('');
  }, [open, card?.id]);

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

  // Calculate the GHN shipping fee for the chosen address.
  const calculateFee = useCallback(async (address: SavedAddress | null) => {
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
        to_district_id: address.district_id.toString(),
        to_ward_code: address.ward_code,
        // Cap declared insurance so GHN's 0.5% insurance fee doesn't inflate
        // shipping on high-value cards. Must match orders/route.ts (INSURANCE_CAP).
        insurance_value: card ? Math.min(card.price, 2000000).toString() : '0',
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

  const handleSelectAddress = useCallback((address: SavedAddress | null) => {
    setSelectedAddress(address);
    void calculateFee(address);
  }, [calculateFee]);

  // Recalculate once the seller address loads in (it may arrive after selection).
  useEffect(() => {
    if (!open || !sellerAddress || !selectedAddress) return;
    void calculateFee(selectedAddress);
  }, [open, sellerAddress, selectedAddress, card?.id, calculateFee]);

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const totalAmount = (card?.price || 0) + (shippingFee || 0);
  const insufficientBalance = walletBalance < totalAmount;

  const canPurchase = !!selectedAddress && shippingFee !== null && !loadingFee;

  const handlePurchase = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card || !selectedAddress || !canPurchase) return;

    setIsPurchasing(true);
    try {
      const res = await fetch('/api/marketplace/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card.id,
          payment_method: paymentMethod,
          shipping_fee: shippingFee,
          to_name: selectedAddress.recipient_name,
          to_phone: selectedAddress.phone,
          to_district_id: selectedAddress.district_id,
          to_district_name: selectedAddress.district_name,
          to_province_id: selectedAddress.province_id,
          to_province_name: selectedAddress.province_name,
          to_ward_code: selectedAddress.ward_code,
          to_ward_name: selectedAddress.ward_name,
          to_address_detail: selectedAddress.detail,
          shipping_address: `${selectedAddress.detail}, ${selectedAddress.ward_name}, ${selectedAddress.district_name}, ${selectedAddress.province_name}`,
        }),
      });

      const data = await res.json();

      // Lost the race: another buyer bought or reserved this card first.
      if (res.status === 409 || data.code === 'card_unavailable') {
        toast({
          variant: 'destructive',
          title: 'Thẻ đã có người mua trước',
          description: data.error || 'Thẻ này không còn khả dụng. Vui lòng chọn thẻ khác.',
        });
        onOpenChange(false);
        onSuccess?.();
        return;
      }

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

          {/* Shipping Address — pick/add/manage straight from checkout */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Truck className="h-4 w-4" />
              Địa chỉ nhận hàng
            </Label>
            <AddressBook
              selectable
              selectedId={selectedAddress?.id ?? null}
              onSelect={handleSelectAddress}
            />
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-gradient-to-b from-accent/40 to-orange-500/5 p-4 space-y-3">
            <p className="text-sm font-semibold">Chi tiết thanh toán</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tiền thẻ</span>
              <span className="font-semibold">{formatVND(card.price)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Truck className="h-4 w-4 text-blue-400" />
                <span>Tiền ship (GHN)</span>
              </div>
              <div>
                {loadingFee ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : shippingFee !== null ? (
                  <span className="font-semibold">{formatVND(shippingFee)}</span>
                ) : feeError ? (
                  <span className="text-xs text-red-400">{feeError}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Chọn địa chỉ để tính</span>
                )}
              </div>
            </div>
            <div className="border-t border-border/50 pt-3 flex items-center justify-between">
              <span className="font-semibold">Tổng thanh toán</span>
              <span className="text-2xl font-bold text-orange-400">
                {shippingFee !== null ? formatVND(totalAmount) : '--'}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Phương thức thanh toán</Label>
            <div className="rounded-lg border border-border/50 bg-accent/20 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tiền thẻ</span>
                <span>{formatVND(card.price)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Tiền ship</span>
                <span>{shippingFee !== null ? formatVND(shippingFee) : '--'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2 font-semibold">
                <span>Tổng cần thanh toán</span>
                <span className="text-orange-400">{shippingFee !== null ? formatVND(totalAmount) : '--'}</span>
              </div>
            </div>
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
                  <p className="text-xs text-muted-foreground">
                    Thanh toán trực tiếp qua ngân hàng • Tổng: {shippingFee !== null ? formatVND(totalAmount) : '--'}
                  </p>
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
