
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, CreditCard, Loader2, CheckCircle, ShieldCheck, ExternalLink, Truck } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { fetchShippingOptions, ShippingOptionsError, type ShippingOption } from '@/lib/shipping-options-client';
import { getCarrier } from '@/lib/shipping-carriers';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { AddressBook, type SavedAddress } from '@/components/address-book';
import { useLocalization } from '@/context/localization-context';
import { isNonCard, productConditionLabel, productCopy } from '@/lib/product-listing';
import { localizeFinancialApiError } from '@/lib/financial-api-errors';
import { getCategoryCode } from '@/lib/category-code';
import Image from 'next/image';

type BundleItem = { title: string; price: number; condition?: string; setName?: string; publisher?: string; season?: string };

type Card = {
  id: string;
  name: string;
  image_url: string;
  price: number;
  category: string;
  condition: string;
  product_kind?: string | null;
  seller_id: string;
  isBundle?: boolean;
  bundleItems?: BundleItem[];
};

type CheckoutModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
  onSuccess?: () => void;
  /** For bundles: indices of the cards the buyer picked in the pre-checkout dialog. */
  preselectedBundle?: number[];
};

export function CheckoutModal({ open, onOpenChange, card, onSuccess, preselectedBundle }: CheckoutModalProps) {
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale, t } = useLocalization();
  const copy = locale === 'ja-JP'
    ? {
        feeError: '送料を計算できませんでした。もう一度お試しください。',
        shippingNotConfigured: '販売者が発送元住所をまだ設定していないため、送料を計算できません。販売者にご連絡ください。',
        sellerNoRoute: 'この販売者は選択した住所へ発送できません。別の住所を選ぶか、販売者にご連絡ください。',
        unavailableTitle: 'カードは先に購入されました',
        unavailableDesc: 'このカードは現在利用できません。別のカードを選んでください。',
        redirecting: 'リダイレクト中...',
        redirectingDesc: 'PayOSページで支払いを完了してください。',
        purchaseSuccess: '購入完了',
        purchaseSuccessDesc: '「{name}」を購入しました。注文ページで確認できます。',
        title: '安全な支払い',
        desc: 'カード購入を確認し、支払い方法を選択してください',
        shippingAddress: '配送先住所',
        paymentDetails: '支払い詳細',
        cardAmount: 'カード代金',
        shippingFee: '送料',
        freeShipping: '送料無料',
        pickCarrier: '配送業者を選択',
        carrierExpected: '到着予定 {expected}',
        carrierSuccess: '配達成功率 {percent}%',
        allInListingFee: '販売者設定の一括送料',
        quoteUnavailable: '現在送料を計算できません。しばらくしてからお試しください。',
        chooseAddressFee: '住所を選択して計算',
        total: '合計支払い',
        paymentMethod: '支払い方法',
        wallet: 'CardVerseHubウォレット',
        balance: '残高',
        insufficient: '不足',
        payos: '銀行振込 / QR (PayOS)',
        payosDesc: '銀行から直接支払い',
        walletShortage: 'ウォレット残高が不足しています。あと {amount} 必要です。',
        topUpNow: '今すぐ入金',
        cancel: 'キャンセル',
        chooseAddressFirst: '先に住所を選択',
        payViaPayos: 'PayOSで支払う',
        errorTitle: 'エラー',
        walletLoadError: 'ウォレット残高を読み込めませんでした。',
        payAmount: '支払う {amount}',
        cardsToBuy: '購入するカード',
        cardFallback: 'カード {number}',
      }
    : locale === 'vi-VN'
      ? {
          feeError: 'Không thể tính phí ship. Vui lòng thử lại.',
          shippingNotConfigured: 'Người bán chưa cập nhật địa chỉ gửi hàng nên chưa tính được phí ship. Bạn thử nhắn cho người bán xem sao.',
          sellerNoRoute: 'Người bán này không giao tới địa chỉ bạn chọn. Thử địa chỉ khác hoặc nhắn cho người bán.',
          unavailableTitle: 'Thẻ đã có người mua trước',
          unavailableDesc: 'Thẻ này không còn khả dụng. Vui lòng chọn thẻ khác.',
          redirecting: 'Đang chuyển hướng...',
          redirectingDesc: 'Vui lòng hoàn tất thanh toán trên trang PayOS.',
          purchaseSuccess: 'Mua thành công',
          purchaseSuccessDesc: 'Bạn đã mua "{name}". Xem đơn hàng tại trang Quản lý đơn hàng.',
          title: 'Thanh toán an toàn',
          desc: 'Xác nhận mua thẻ và chọn phương thức thanh toán',
          shippingAddress: 'Địa chỉ nhận hàng',
          paymentDetails: 'Chi tiết thanh toán',
          cardAmount: 'Tiền thẻ',
          shippingFee: 'Phí vận chuyển',
          freeShipping: 'Miễn phí',
          pickCarrier: 'Chọn đơn vị vận chuyển',
          carrierExpected: 'Dự kiến {expected}',
          carrierSuccess: '{percent}% giao thành công',
          allInListingFee: 'Phí trọn gói do người bán đặt',
          quoteUnavailable: 'Chưa tính được phí ship lúc này. Thử lại sau ít phút.',
          chooseAddressFee: 'Chọn địa chỉ để tính',
          total: 'Tổng thanh toán',
          paymentMethod: 'Phương thức thanh toán',
          wallet: 'Ví Cardverse',
          balance: 'Số dư',
          insufficient: 'Không đủ',
          payos: 'Chuyển khoản / QR (PayOS)',
          payosDesc: 'Thanh toán trực tiếp qua ngân hàng',
          walletShortage: 'Số dư ví không đủ. Bạn cần thêm {amount}.',
          topUpNow: 'Nạp tiền ngay',
          cancel: 'Hủy',
          chooseAddressFirst: 'Chọn địa chỉ trước',
          payViaPayos: 'Thanh toán qua PayOS',
          errorTitle: 'Lỗi',
          walletLoadError: 'Không thể tải số dư ví.',
          payAmount: 'Thanh toán {amount}',
          cardsToBuy: 'Thẻ sẽ mua',
          cardFallback: 'Thẻ {number}',
        }
      : {
          feeError: 'Could not calculate shipping fee. Please try again.',
          shippingNotConfigured: 'The seller has not set a shipping origin address yet, so the fee cannot be calculated. You can message them.',
          sellerNoRoute: 'This seller cannot deliver to the address you picked. Try another address, or message them.',
          unavailableTitle: 'Card already taken',
          unavailableDesc: 'This card is no longer available. Please choose another card.',
          redirecting: 'Redirecting...',
          redirectingDesc: 'Please complete payment on the PayOS page.',
          purchaseSuccess: 'Purchase successful',
          purchaseSuccessDesc: 'You bought "{name}". View the order on the Orders page.',
          title: 'Secure checkout',
          desc: 'Confirm the card purchase and choose a payment method',
          shippingAddress: 'Shipping address',
          paymentDetails: 'Payment details',
          cardAmount: 'Card price',
          shippingFee: 'Shipping fee',
          freeShipping: 'Free',
          pickCarrier: 'Pick a carrier',
          carrierExpected: 'Expected {expected}',
          carrierSuccess: '{percent}% delivered',
          allInListingFee: 'All-in fee set by the seller',
          quoteUnavailable: 'Shipping cannot be quoted right now. Try again in a few minutes.',
          chooseAddressFee: 'Choose an address to calculate',
          total: 'Total payment',
          paymentMethod: 'Payment method',
          wallet: 'CardVerseHub wallet',
          balance: 'Balance',
          insufficient: 'Insufficient',
          payos: 'Bank transfer / QR (PayOS)',
          payosDesc: 'Direct bank payment',
          walletShortage: 'Wallet balance is insufficient. You need {amount} more.',
          topUpNow: 'Top up now',
          cancel: 'Cancel',
          chooseAddressFirst: 'Choose address first',
          payViaPayos: 'Pay via PayOS',
          errorTitle: 'Error',
          walletLoadError: 'Unable to load wallet balance.',
          payAmount: 'Pay {amount}',
          cardsToBuy: 'Cards to buy',
          cardFallback: 'Card {number}',
        };
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'direct_payos'>('wallet');
  // Bundle: indices of the cards the buyer wants to buy (default = all).
  const [selectedBundle, setSelectedBundle] = useState<number[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const purchaseRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  // Shipping — address comes from the buyer's TikTok-style address book.
  const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
  // Every carrier GoShip returns for this route that the seller enables,
  // cheapest first; the buyer picks one. A seller-priced listing comes back as
  // exactly one option with nothing to pick.
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [chosenCarrier, setChosenCarrier] = useState<string | null>(null);
  const shippingQuote = shippingOptions.find(o => o.carrier === chosenCarrier) ?? shippingOptions[0] ?? null;
  const shippingFee = shippingQuote?.fee ?? null;
  const [loadingFee, setLoadingFee] = useState(false);
  const [feeError, setFeeError] = useState('');
  // Guards against a slow answer for an old address landing after a fast one
  // for the new address, which would show a fee for somewhere else entirely.
  const feeRequestRef = useRef(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (open && userId) {
      fetchWalletBalance();
    }
  }, [open, userId]);

  const bundleItems = card?.isBundle ? card.bundleItems || [] : [];
  const isBundle = bundleItems.length > 0;

  useEffect(() => {
    if (!open) return;
    setSelectedAddress(null);
    setShippingOptions([]);
    setChosenCarrier(null);
    setFeeError('');
    // Cards chosen in the pre-checkout dialog; fall back to all if none passed.
    setSelectedBundle(
      preselectedBundle && preselectedBundle.length
        ? preselectedBundle
        : (card?.isBundle ? (card.bundleItems || []).map((_, i) => i) : []),
    );
  }, [open, card?.id, preselectedBundle]);

  const fetchWalletBalance = async () => {
    setIsLoadingWallet(true);
    try {
      const res = await fetch('/api/wallet?view=balance', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.walletLoadError);
      setWalletBalance(data.wallet?.available_balance || 0);
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
      toast({
        variant: 'destructive',
        title: copy.errorTitle,
        description: err instanceof Error ? err.message : copy.walletLoadError,
      });
    } finally {
      setIsLoadingWallet(false);
    }
  };

  /**
   * What this parcel costs to the address the buyer picked.
   *
   * Asked of the server, never worked out here. This used to read the listing
   * row and fall back to a constant whenever the listing set no fee of its own,
   * which printed 25,000đ on parcels /api/marketplace/buy then billed at the
   * seller's own price — the dialog and the charge disagreed, and the charge
   * won. Now both ends call the same resolver.
   *
   * GoShip prices the route for every carrier the seller enables; the buyer
   * picks one and the buy route bills that carrier, re-quoted, by code.
   */
  const calculateFee = useCallback(async (address: SavedAddress | null) => {
    const requestId = ++feeRequestRef.current;
    setShippingOptions([]);
    setFeeError('');

    if (!address || !card) return;
    // An address saved before the book moved to GoShip's geography cannot be
    // quoted; the book flags it and opens the form instead of selecting it.
    if (!address.goship) { setFeeError(copy.feeError); return; }

    setLoadingFee(true);
    try {
      const options = await fetchShippingOptions({
        to: { city: address.goship.city, district: address.goship.district },
        sellerId: card.seller_id,
        // A bundle is one listing and one parcel, quoted by its listing id —
        // the same id /api/marketplace/buy quotes when it charges for it.
        cardIds: [card.id],
      });
      if (requestId !== feeRequestRef.current) return;
      setShippingOptions(options);
      // Keep the buyer's pick across an address change when it still applies.
      setChosenCarrier(prev => (prev && options.some(o => o.carrier === prev) ? prev : options[0]?.carrier ?? null));
    } catch (err) {
      if (requestId !== feeRequestRef.current) return;
      const code = err instanceof ShippingOptionsError ? err.code : '';
      setShippingOptions([]);
      setFeeError(
        code === 'seller_does_not_ship_here' ? copy.sellerNoRoute
          : code === 'seller_shipping_origin_missing' || code === 'seller_shipping_configuration_missing'
            ? copy.shippingNotConfigured
            : code === 'shipping_quote_failed'
              ? copy.quoteUnavailable
              : copy.feeError,
      );
      if (!code) console.error('Fee calculation error:', err);
    } finally {
      if (requestId === feeRequestRef.current) setLoadingFee(false);
    }
  }, [card, copy.feeError, copy.quoteUnavailable, copy.sellerNoRoute, copy.shippingNotConfigured]);

  const handleSelectAddress = useCallback((address: SavedAddress | null) => {
    setSelectedAddress(address);
    void calculateFee(address);
  }, [calculateFee]);

  // Recalculate whenever the buyer's address / card changes.
  useEffect(() => {
    if (!open || !selectedAddress) return;
    void calculateFee(selectedAddress);
  }, [open, selectedAddress, card?.id, calculateFee]);

  const formatVND = (amount: number) => new Intl.NumberFormat(locale).format(amount) + '₫';

  const selectedSubtotal = isBundle
    ? selectedBundle.reduce((sum, i) => sum + (bundleItems[i]?.price || 0), 0)
    : (card?.price || 0);
  const totalAmount = selectedSubtotal + (shippingFee || 0);
  const insufficientBalance = walletBalance < totalAmount;

  const canPurchase =
    !!selectedAddress && shippingFee !== null && !loadingFee &&
    (!isBundle || selectedBundle.length > 0);

  const handlePurchase = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card || !selectedAddress || !canPurchase) return;

    setIsPurchasing(true);
    try {
      const fingerprint = JSON.stringify({
        cardId: card.id,
        paymentMethod,
        shippingFee,
        shippingCarrier: shippingQuote?.carrier ?? null,
        selectedBundle,
        addressId: selectedAddress.id,
      });
      if (purchaseRequestRef.current?.fingerprint !== fingerprint) {
        purchaseRequestRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      const res = await fetch('/api/marketplace/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': purchaseRequestRef.current.key,
          'X-CardVerseHub-Locale': locale,
        },
        body: JSON.stringify({
          card_id: card.id,
          payment_method: paymentMethod,
          // The buyer's carrier, by code. The route re-quotes it with GoShip
          // and bills that; the fee is echoed only for the idempotency hash.
          shipping_carrier: shippingQuote?.carrier ?? null,
          shipping_fee: shippingFee,
          bundle_selection: isBundle
            ? selectedBundle.map(i => ({ title: bundleItems[i]?.title || '', price: bundleItems[i]?.price || 0 }))
            : undefined,
          // The address by id only. The server reads the recipient, the text
          // and GoShip's ids from the buyer's own saved row, so the parcel is
          // priced and booked for exactly where the label says.
          address_id: selectedAddress.id,
        }),
      });

      const data = await res.json();

      // Lost the race: another buyer bought or reserved this card first.
      if (data.code === 'card_unavailable' || data.code === 'bundle_item_unavailable') {
        toast({
          variant: 'destructive',
          title: copy.unavailableTitle,
          description: localizeFinancialApiError(t, data.code, copy.unavailableDesc),
        });
        onOpenChange(false);
        onSuccess?.();
        return;
      }

      if (!res.ok) {
        throw new Error(localizeFinancialApiError(t, data.code, copy.errorTitle));
      }
      purchaseRequestRef.current = null;

      if (data.payment_method === 'direct_payos') {
        if (!data.checkoutUrl) {
          // PayOS didn't return a payment link — surface it instead of silently
          // "succeeding" and closing the dialog with an orphaned pending order.
          toast({
            variant: 'destructive',
            title: copy.errorTitle,
            description: localizeFinancialApiError(t, data.code || 'payos_link_missing', copy.errorTitle),
          });
          return;
        }
        // Same-tab redirect — window.open('_blank') after an await is blocked by
        // the popup blocker (not a direct user gesture).
        toast({ title: copy.redirecting, description: copy.redirectingDesc });
        window.location.href = data.checkoutUrl;
        return;
      }

      toast({
        title: copy.purchaseSuccess,
        description: copy.purchaseSuccessDesc.replace('{name}', card.name),
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ variant: 'destructive', title: copy.errorTitle, description: err.message });
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
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Card Summary */}
          <div className="flex gap-3 p-3 rounded-lg bg-accent/50">
            {card.image_url && (
              <div className="relative h-[88px] w-16 rounded overflow-hidden flex-shrink-0">
                <Image src={card.image_url} alt="" width={64} height={88} className="object-cover rounded" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold line-clamp-2 text-sm">{card.name}</p>
              <p className="text-xs text-muted-foreground">{getCategoryCode(card.category)}{isNonCard(card.product_kind) ? ` • ${productCopy(locale)[card.product_kind as 'box']}` : ''} • {productConditionLabel(card.condition, locale)}</p>
              <p className="text-lg font-bold text-orange-500 mt-1">{formatVND(isBundle ? selectedSubtotal : card.price)}</p>
            </div>
          </div>

          {/* Bundle: cards chosen in the pre-checkout dialog (read-only here) */}
          {isBundle && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {copy.cardsToBuy}
                <span className="ml-1 text-muted-foreground">({selectedBundle.length}/{bundleItems.length})</span>
              </Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                {selectedBundle.map(i => bundleItems[i]).filter(Boolean).map((it, k) => (
                  <div key={k} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {it.title || copy.cardFallback.replace('{number}', String(k + 1))}
                    </span>
                    <span className="shrink-0 font-semibold text-orange-500">{formatVND(it.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shipping Address — pick/add/manage straight from checkout */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Truck className="h-4 w-4" />
              {copy.shippingAddress}
            </Label>
            <AddressBook
              selectable
              selectedId={selectedAddress?.id ?? null}
              onSelect={handleSelectAddress}
            />
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-gradient-to-b from-accent/40 to-orange-500/5 p-4 space-y-3">
            <p className="text-sm font-semibold">{copy.paymentDetails}</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{copy.cardAmount}{isBundle ? ` (${selectedBundle.length})` : ''}</span>
              <span className="font-semibold">{formatVND(selectedSubtotal)}</span>
            </div>
            {loadingFee ? (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{copy.shippingFee}</span>
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : shippingQuote ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Truck className="h-4 w-4 text-blue-400" />
                    {copy.shippingFee}
                  </span>
                  <span className="font-semibold">{shippingFee === 0 ? copy.freeShipping : formatVND(shippingQuote.fee)}</span>
                </div>
                {shippingQuote.listingOverride ? (
                  <p className="pl-6 text-[11px] text-muted-foreground">{copy.allInListingFee}</p>
                ) : shippingOptions.length > 1 ? (
                  <RadioGroup value={shippingQuote.carrier} onValueChange={setChosenCarrier} className="space-y-1.5 pl-6" aria-label={copy.pickCarrier}>
                    {shippingOptions.map(option => {
                      const carrier = getCarrier(option.carrier);
                      const on = option.carrier === shippingQuote.carrier;
                      return (
                        <label key={option.carrier} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs transition-colors ${on ? 'border-orange-500/60 bg-orange-500/5' : 'border-border/60 hover:bg-accent/40'}`}>
                          <RadioGroupItem value={option.carrier} id={`carrier-${option.carrier}`} />
                          {carrier?.logo && <img src={carrier.logo} alt="" className="h-4 w-4 rounded object-contain" />}
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{carrier?.name ?? option.carrier.toUpperCase()}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {[
                                option.expected ? copy.carrierExpected.replace('{expected}', option.expected) : null,
                                typeof option.successPercent === 'number' ? copy.carrierSuccess.replace('{percent}', String(Math.round(option.successPercent))) : null,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="font-semibold">{formatVND(option.fee)}</span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                ) : (
                  <p className="pl-6 text-[11px] text-muted-foreground">{getCarrier(shippingQuote.carrier)?.name ?? shippingQuote.carrier.toUpperCase()}</p>
                )}
              </div>
            ) : (
              <div className={`text-xs ${feeError ? 'text-red-400' : 'text-muted-foreground'}`}>
                {feeError || copy.chooseAddressFee}
              </div>
            )}
            <div className="border-t border-border/50 pt-3 flex items-center justify-between">
              <span className="font-semibold">{copy.total}</span>
              <span className="text-2xl font-bold text-orange-400">
                {shippingFee !== null ? formatVND(totalAmount) : '--'}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">{copy.paymentMethod}</Label>
            <RadioGroup value={paymentMethod} onValueChange={v => setPaymentMethod(v as 'wallet' | 'direct_payos')} className="mt-2 space-y-2">
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === 'wallet' ? 'border-orange-500 bg-orange-500/5' : 'hover:bg-accent/50'}`}>
                <RadioGroupItem value="wallet" id="wallet" />
                <Wallet className="h-5 w-5 text-orange-500" />
                <div className="flex-1">
                  <p className="font-medium text-sm">{copy.wallet}</p>
                  <p className={`text-xs ${insufficientBalance ? 'text-red-400' : 'text-green-400'}`}>
                    {copy.balance}: {isLoadingWallet ? '...' : formatVND(walletBalance)}
                    {insufficientBalance && !isLoadingWallet && ` (${copy.insufficient})`}
                  </p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === 'direct_payos' ? 'border-orange-500 bg-orange-500/5' : 'hover:bg-accent/50'}`}>
                <RadioGroupItem value="direct_payos" id="direct" />
                <CreditCard className="h-5 w-5 text-blue-500" />
                <div className="flex-1">
                  <p className="font-medium text-sm">{copy.payos}</p>
                  <p className="text-xs text-muted-foreground">
                    {copy.payosDesc} • {copy.total}: {shippingFee !== null ? formatVND(totalAmount) : '--'}
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Insufficient balance warning */}
          {paymentMethod === 'wallet' && insufficientBalance && !isLoadingWallet && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
              {copy.walletShortage.replace('{amount}', formatVND(totalAmount - walletBalance))}
              <Button variant="link" size="sm" className="text-orange-400 p-0 h-auto ml-1" asChild>
                <a href="/wallet" target="_blank">{copy.topUpNow} <ExternalLink className="h-3 w-3 ml-1" /></a>
              </Button>
            </div>
          )}

        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button
            onClick={handlePurchase}
            disabled={isPurchasing || !canPurchase || (paymentMethod === 'wallet' && insufficientBalance)}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold"
          >
            {isPurchasing ? null : <CheckCircle className="h-4 w-4 mr-2" />}
            {shippingFee !== null
              ? copy.payAmount.replace('{amount}', formatVND(totalAmount))
              : paymentMethod === 'wallet'
                ? copy.chooseAddressFirst
                : copy.payViaPayos
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
