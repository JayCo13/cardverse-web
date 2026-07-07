"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { AddressBook, type SavedAddress } from "@/components/address-book";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/supabase";
import { useSupabase } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useToast } from "@/hooks/use-toast";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCategoryCode } from "@/lib/category-code";
import { CreditCard, Loader2, PackageCheck, ShieldCheck, Store, Truck, Wallet } from "lucide-react";
import { useLocalization } from "@/context/localization-context";

type CheckoutItem = {
  cartItemId?: string;
  offerId?: string;
  card: {
    id: string;
    name: string;
    imageUrl: string;
    category: string;
    condition?: string | null;
    price: number;
    sellerId: string;
    sellerName?: string | null;
    sellerPickup?: { districtId: number; wardCode: string } | null;
  };
  amount: number;
  shippingFee: number | null;
};

const formatVND = (amount: number) => new Intl.NumberFormat("vi-VN").format(amount) + "\u00A0đ";

export default function CheckoutPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const offerId = searchParams.get("offerId");
  // Cart selection from /cart (Shopee-style): only these cart item ids are
  // checked out. Absent/empty param keeps the legacy "whole cart" behavior.
  const selectedCartItemsParam = searchParams.get("items");
  const supabase = useSupabase();
  const { user, isLoading } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const copy = locale === "vi-VN"
    ? {
      pageTitle: "Checkout",
      pageSubtitle: "Xác nhận địa chỉ, phí ship và phương thức thanh toán.",
      loadCartError: "Không thể tải giỏ hàng",
      offerNotFound: "Không tìm thấy offer.",
      offerForbidden: "Bạn không có quyền thanh toán offer này.",
      offerNotReady: "Offer này chưa sẵn sàng để checkout.",
      openCheckoutError: "Không thể mở checkout",
      shippingFeeError: "Không thể tính phí ship",
      shippingFeeTitle: "Lỗi phí ship",
      payError: "Không thể thanh toán",
      payosTitle: "Đang chuyển tới PayOS",
      payosDescription: "Vui lòng hoàn tất thanh toán trên trang PayOS.",
      paymentSuccess: "Thanh toán thành công",
      emptyTitle: "Không có sản phẩm để checkout",
      backToCart: "Về giỏ hàng",
      shippingAddress: "Địa chỉ nhận hàng",
      missingPickup: "Một số seller chưa cập nhật địa chỉ gửi hàng. Vui lòng chọn sản phẩm khác hoặc liên hệ seller.",
      products: "Sản phẩm",
      seller: "Seller",
      cardVerseSeller: "CardVerse seller",
      ship: "Ship",
      calculating: "Đang tính...",
      chooseAddressForFee: "Chọn địa chỉ để tính",
      ghnReady: "GHN ready",
      payment: "Thanh toán",
      walletPayos: "Ví / PayOS",
      protection: "Bảo vệ",
      protected: "CardVerse giữ tiền",
      itemPrice: "Giá thẻ",
      shippingAtCheckout: "Phí ship theo địa chỉ",
      combinedShipping: "Gộp chung lô",
      paymentMethod: "Phương thức thanh toán",
      wallet: "Ví CardVerse",
      balance: "Số dư",
      payos: "Chuyển khoản / QR PayOS",
      payosDesc: "Thanh toán qua ngân hàng nội địa.",
      orderSummary: "Tóm tắt đơn hàng",
      subtotal: "Tạm tính",
      shipping: "Phí ship",
      total: "Thành tiền",
      insufficient: "Số dư ví không đủ. Vui lòng nạp thêm hoặc chọn PayOS.",
      payWithPayos: "Thanh toán qua PayOS",
      pay: "Thanh toán",
    }
    : locale === "ja-JP"
      ? {
        pageTitle: "チェックアウト",
        pageSubtitle: "配送先、送料、支払い方法を確認してください。",
        loadCartError: "カートを読み込めません",
        offerNotFound: "オファーが見つかりません。",
        offerForbidden: "このオファーを支払う権限がありません。",
        offerNotReady: "このオファーはまだチェックアウトできません。",
        openCheckoutError: "チェックアウトを開けません",
        shippingFeeError: "送料を計算できません",
        shippingFeeTitle: "送料エラー",
        payError: "支払いできません",
        payosTitle: "PayOSへ移動しています",
        payosDescription: "PayOSページで支払いを完了してください。",
        paymentSuccess: "支払いが完了しました",
        emptyTitle: "チェックアウトする商品がありません",
        backToCart: "カートへ戻る",
        shippingAddress: "配送先住所",
        missingPickup: "一部の販売者が発送元住所を未設定です。別の商品を選ぶか販売者に連絡してください。",
        products: "商品",
        seller: "販売者",
        cardVerseSeller: "CardVerse販売者",
        ship: "配送",
        calculating: "計算中...",
        chooseAddressForFee: "住所を選択して計算",
        ghnReady: "GHN対応",
        payment: "支払い",
        walletPayos: "ウォレット / PayOS",
        protection: "保護",
        protected: "CardVerseが代金を保持",
        itemPrice: "商品価格",
        shippingAtCheckout: "住所に基づく送料",
        combinedShipping: "同梱配送",
        paymentMethod: "支払い方法",
        wallet: "CardVerseウォレット",
        balance: "残高",
        payos: "銀行振込 / QR PayOS",
        payosDesc: "国内銀行決済で支払います。",
        orderSummary: "注文概要",
        subtotal: "小計",
        shipping: "送料",
        total: "合計",
        insufficient: "ウォレット残高が不足しています。チャージするかPayOSを選択してください。",
        payWithPayos: "PayOSで支払う",
        pay: "支払う",
      }
      : {
        pageTitle: "Checkout",
        pageSubtitle: "Confirm your address, shipping fee, and payment method.",
        loadCartError: "Unable to load cart",
        offerNotFound: "Offer not found.",
        offerForbidden: "You are not allowed to pay for this offer.",
        offerNotReady: "This offer is not ready for checkout.",
        openCheckoutError: "Unable to open checkout",
        shippingFeeError: "Unable to calculate shipping fee",
        shippingFeeTitle: "Shipping fee error",
        payError: "Unable to pay",
        payosTitle: "Opening PayOS",
        payosDescription: "Please complete payment on the PayOS page.",
        paymentSuccess: "Payment successful",
        emptyTitle: "No items to checkout",
        backToCart: "Back to cart",
        shippingAddress: "Shipping address",
        missingPickup: "Some sellers have not added a pickup address. Please choose another item or contact the seller.",
        products: "Products",
        seller: "Seller",
        cardVerseSeller: "CardVerse seller",
        ship: "Ship",
        calculating: "Calculating...",
        chooseAddressForFee: "Choose an address to calculate",
        ghnReady: "GHN ready",
        payment: "Payment",
        walletPayos: "Wallet / PayOS",
        protection: "Protection",
        protected: "CardVerse held",
        itemPrice: "Item price",
        shippingAtCheckout: "Address-based shipping",
        combinedShipping: "Combined shipment",
        paymentMethod: "Payment method",
        wallet: "CardVerse Wallet",
        balance: "Balance",
        payos: "Bank transfer / QR PayOS",
        payosDesc: "Pay through domestic bank transfer.",
        orderSummary: "Order summary",
        subtotal: "Subtotal",
        shipping: "Shipping",
        total: "Total",
        insufficient: "Wallet balance is not enough. Please top up or choose PayOS.",
        payWithPayos: "Pay with PayOS",
        pay: "Pay",
      };

  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "direct_payos">("wallet");
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isLoadingFee, setIsLoadingFee] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const isOfferCheckout = !!offerId;

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      const payload = await response.json();
      setWalletBalance(payload.wallet?.available_balance || 0);
    } catch {
      setWalletBalance(0);
    }
  }, []);

  const loadCart = useCallback(async () => {
    const response = await fetch("/api/cart", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || copy.loadCartError);

    const selectedIds = (selectedCartItemsParam || "")
      .split(",")
      .map(id => id.trim())
      .filter(Boolean);

    const mapped: CheckoutItem[] = (payload.items || [])
      .filter((item: any) => item.cards?.status === "active" && item.cards?.listing_type === "sale")
      .filter((item: any) => selectedIds.length === 0 || selectedIds.includes(item.id))
      .map((item: any) => ({
        cartItemId: item.id,
        card: {
          id: item.cards.id,
          name: item.cards.name,
          imageUrl: item.cards.image_url || "",
          category: item.cards.category,
          condition: item.cards.condition,
          price: Number(item.cards.price || 0),
          sellerId: item.cards.seller_id,
          sellerName: item.cards.profiles?.display_name,
          sellerPickup: item.cards.profiles?.address_district_id && item.cards.profiles?.address_ward_code
            ? {
              districtId: item.cards.profiles.address_district_id,
              wardCode: item.cards.profiles.address_ward_code,
            }
            : null,
        },
        amount: Number(item.cards.price || 0),
        shippingFee: null,
      }));

    setItems(mapped);
  }, [copy.loadCartError, selectedCartItemsParam]);

  const loadOffer = useCallback(async () => {
    if (!offerId) return;

    const { data: offer, error } = await supabase
      .from("offers")
      .select(`
        id,
        price,
        status,
        buyer_id,
        cards:card_id(
          id,
          name,
          image_url,
          category,
          condition,
          seller_id,
          profiles:seller_id(
            display_name,
            address_district_id,
            address_ward_code
          )
        )
      `)
      .eq("id", offerId)
      .single();

    if (error || !offer) throw new Error(copy.offerNotFound);
    const row = offer as any;
    if (row.buyer_id !== user?.id) throw new Error(copy.offerForbidden);
    if (row.status !== "chosen") throw new Error(copy.offerNotReady);

    const card = row.cards;
    setItems([{
      offerId: row.id,
      card: {
        id: card.id,
        name: card.name,
        imageUrl: card.image_url || "",
        category: card.category,
        condition: card.condition,
        price: Number(row.price || 0),
        sellerId: card.seller_id,
        sellerName: card.profiles?.display_name,
        sellerPickup: card.profiles?.address_district_id && card.profiles?.address_ward_code
          ? {
            districtId: card.profiles.address_district_id,
            wardCode: card.profiles.address_ward_code,
          }
          : null,
      },
      amount: Number(row.price || 0),
      shippingFee: null,
    }]);
  }, [copy.offerForbidden, copy.offerNotFound, copy.offerNotReady, offerId, supabase, user?.id]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setAuthOpen(true);
      setIsLoadingData(false);
      return;
    }

    const load = async () => {
      setIsLoadingData(true);
      try {
        await Promise.all([loadWallet(), isOfferCheckout ? loadOffer() : loadCart()]);
      } catch (error: any) {
        toast({ variant: "destructive", title: copy.openCheckoutError, description: error.message });
      } finally {
        setIsLoadingData(false);
      }
    };

    void load();
  }, [copy.openCheckoutError, isLoading, isOfferCheckout, loadCart, loadOffer, loadWallet, setAuthOpen, toast, user]);

  const calculateFees = useCallback(async (address: SavedAddress | null, currentItems: CheckoutItem[]) => {
    if (!address) return;
    setIsLoadingFee(true);
    try {
      const nextItems = currentItems.map(item => ({ ...item, shippingFee: item.card.sellerPickup ? 0 : null }));
      const groups = new Map<string, { indexes: number[]; districtId: number; wardCode: string; insuranceValue: number }>();

      currentItems.forEach((item, index) => {
        const pickup = item.card.sellerPickup;
        if (!pickup) return;

        const key = `${item.card.sellerId}:${pickup.districtId}:${pickup.wardCode}`;
        const current = groups.get(key);
        if (current) {
          current.indexes.push(index);
          current.insuranceValue += item.amount;
          return;
        }

        groups.set(key, {
          indexes: [index],
          districtId: pickup.districtId,
          wardCode: pickup.wardCode,
          insuranceValue: item.amount,
        });
      });

      await Promise.all(Array.from(groups.values()).map(async group => {
        const params = new URLSearchParams({
          from_district_id: group.districtId.toString(),
          from_ward_code: group.wardCode,
          to_district_id: address.district_id.toString(),
          to_ward_code: address.ward_code,
          insurance_value: Math.min(group.insuranceValue, 500000).toString(), // GHN insurance cap; CardVerse escrow covers the rest
        });
        const response = await fetch(`/api/shipping/fee?${params}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || copy.shippingFeeError);
        const fee = Number(payload.shipping_fee || 0);
        group.indexes.forEach((itemIndex, groupIndex) => {
          nextItems[itemIndex] = {
            ...nextItems[itemIndex],
            shippingFee: groupIndex === 0 ? fee : 0,
          };
        });
      }));

      setItems(nextItems);
    } catch (error: any) {
      toast({ variant: "destructive", title: copy.shippingFeeTitle, description: error.message });
      setItems(currentItems.map(item => ({ ...item, shippingFee: null })));
    } finally {
      setIsLoadingFee(false);
    }
  }, [copy.shippingFeeError, copy.shippingFeeTitle, toast]);

  const handleSelectAddress = (address: SavedAddress | null) => {
    setSelectedAddress(address);
    void calculateFees(address, items);
  };

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);
  const shippingTotal = useMemo(() => items.reduce((sum, item) => sum + (item.shippingFee || 0), 0), [items]);
  const total = subtotal + shippingTotal;
  const hasMissingFee = items.some(item => item.shippingFee === null);
  const hasMissingPickup = items.some(item => !item.card.sellerPickup);
  const insufficient = paymentMethod === "wallet" && walletBalance < total;
  const canPay = !!selectedAddress && items.length > 0 && !hasMissingFee && !hasMissingPickup && !isLoadingFee && !isPaying && !insufficient;

  const handlePay = async () => {
    if (!selectedAddress || !canPay) return;
    setIsPaying(true);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: isOfferCheckout ? "offer" : "cart",
          offer_id: offerId,
          payment_method: paymentMethod,
          shipping_fee: items[0]?.shippingFee || 0,
          items: items.map(item => ({
            cart_item_id: item.cartItemId,
            card_id: item.card.id,
            shipping_fee: item.shippingFee || 0,
          })),
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.payError);

      window.dispatchEvent(new Event("cardverse:cart-updated"));
      if (payload.payment_method === "direct_payos" && payload.checkoutUrl) {
        window.open(payload.checkoutUrl, "_blank");
        toast({ title: copy.payosTitle, description: copy.payosDescription });
      } else {
        toast({ title: copy.paymentSuccess });
        router.push("/orders");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: copy.payError, description: error.message });
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-normal">{copy.pageTitle}</h1>
          <p className="text-muted-foreground">{copy.pageSubtitle}</p>
        </div>

        {isLoadingData ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Skeleton className="h-[600px] rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <h2 className="text-xl font-semibold">{copy.emptyTitle}</h2>
            <Button className="mt-5" onClick={() => router.push("/cart")}>{copy.backToCart}</Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="space-y-6">
              <div className="rounded-xl border bg-card p-5">
                <Label className="mb-3 flex items-center gap-2 text-base font-semibold">
                  <Truck className="h-5 w-5 text-orange-400" />
                  {copy.shippingAddress}
                </Label>
                <AddressBook selectable selectedId={selectedAddress?.id ?? null} onSelect={handleSelectAddress} />
                {hasMissingPickup && (
                  <p className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                    {copy.missingPickup}
                  </p>
                )}
              </div>

              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-4 text-lg font-semibold">{copy.products}</h2>
                <div className="space-y-4">
                  {items.map(item => (
                    <div
                      key={item.cartItemId || item.offerId || item.card.id}
                      className="overflow-hidden rounded-xl border bg-background/50 transition hover:border-orange-500/35 sm:grid sm:grid-cols-[132px_minmax(0,1fr)_190px]"
                    >
                      <div className="relative min-h-[184px] bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-3">
                        <div className="relative mx-auto aspect-[3/4] h-full max-h-[174px] w-[112px] overflow-hidden rounded-lg border border-white/10 bg-muted shadow-[0_18px_45px_rgba(0,0,0,0.4)]">
                          {item.card.imageUrl ? (
                            <Image src={optimizeCloudinaryUrl(item.card.imageUrl, 320)} alt={item.card.name} fill className="object-cover" />
                          ) : null}
                        </div>
                        <span className="absolute left-3 top-3 rounded-md border border-orange-400/50 bg-orange-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                          {getCategoryCode(item.card.category)}
                        </span>
                      </div>

                      <div className="min-w-0 p-4">
                        <div className="mb-2 flex flex-wrap gap-2">
                          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-muted-foreground">
                            Qty 1
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xl font-bold tracking-normal">{item.card.name}</p>
                        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <Store className="h-4 w-4 text-orange-300" />
                          <span className="truncate">{item.card.sellerName || copy.seller}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span>{copy.cardVerseSeller}</span>
                        </div>
                        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                          <div className="rounded-lg border border-white/10 bg-card/60 p-2.5">
                            <p className="mb-1 text-xs text-muted-foreground whitespace-nowrap leading-tight">{copy.ship}</p>
                            <p className="font-semibold leading-tight">{copy.ghnReady}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-card/60 p-2.5">
                            <p className="mb-1 text-xs text-muted-foreground whitespace-nowrap leading-tight">{copy.payment}</p>
                            <p className="font-semibold leading-tight">{copy.walletPayos}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-card/60 p-2.5">
                            <p className="mb-1 text-xs text-muted-foreground whitespace-nowrap leading-tight">{copy.protection}</p>
                            <p className="font-semibold leading-tight">{copy.protected}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between gap-3 border-t p-4 sm:border-l sm:border-t-0">
                        <div className="sm:text-right">
                          <p className="text-sm text-muted-foreground">{copy.itemPrice}</p>
                          <p className="text-2xl font-bold tracking-normal text-orange-400">{formatVND(item.amount)}</p>
                        </div>
                        <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{copy.shipping}</span>
                            <span className="font-semibold text-orange-100 text-right">
                              {isLoadingFee
                                ? copy.calculating
                                : item.shippingFee !== null
                                  ? item.shippingFee === 0
                                    ? `${formatVND(0)} · ${copy.combinedShipping}`
                                    : formatVND(item.shippingFee)
                                  : copy.chooseAddressForFee}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{copy.shippingAtCheckout}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-4 text-lg font-semibold">{copy.paymentMethod}</h2>
                <RadioGroup value={paymentMethod} onValueChange={value => setPaymentMethod(value as "wallet" | "direct_payos")} className="space-y-3">
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${paymentMethod === "wallet" ? "border-orange-500 bg-orange-500/10" : "hover:bg-muted/40"}`}>
                    <RadioGroupItem value="wallet" id="wallet" />
                    <Wallet className="h-5 w-5 text-orange-400" />
                    <div>
                      <p className="font-medium">{copy.wallet}</p>
                      <p className={`text-sm ${insufficient ? "text-red-400" : "text-muted-foreground"}`}>{copy.balance}: {formatVND(walletBalance)}</p>
                    </div>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${paymentMethod === "direct_payos" ? "border-orange-500 bg-orange-500/10" : "hover:bg-muted/40"}`}>
                    <RadioGroupItem value="direct_payos" id="direct_payos" />
                    <CreditCard className="h-5 w-5 text-blue-400" />
                    <div>
                      <p className="font-medium">{copy.payos}</p>
                      <p className="text-sm text-muted-foreground">{copy.payosDesc}</p>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            </section>

            <aside className="lg:sticky lg:top-32 lg:self-start">
              <div className="rounded-xl border bg-card p-5 shadow-[0_20px_80px_rgba(0,0,0,0.24)]">
                <div className="mb-5 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-orange-400" />
                  <h2 className="text-xl font-semibold">{copy.orderSummary}</h2>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{copy.subtotal}</span>
                    <span>{formatVND(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{copy.shipping}</span>
                    <span>{hasMissingFee ? "--" : formatVND(shippingTotal)}</span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>{copy.total}</span>
                      <span className="text-orange-400">{hasMissingFee ? "--" : formatVND(total)}</span>
                    </div>
                  </div>
                  {insufficient && (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300">
                      {copy.insufficient}
                    </p>
                  )}
                </div>
                <Button
                  className="mt-5 h-12 w-full bg-orange-500 font-bold text-white hover:bg-orange-600"
                  disabled={!canPay}
                  onClick={handlePay}
                >
                  {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {paymentMethod === "direct_payos" ? copy.payWithPayos : copy.pay}
                </Button>
              </div>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
