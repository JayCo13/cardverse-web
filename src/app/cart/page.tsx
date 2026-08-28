"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, CreditCard, Eye, PackageCheck, ShieldCheck, ShoppingCart, Store, Trash2, Truck } from "lucide-react";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCategoryCode } from "@/lib/category-code";
import { shopShippingRange, type ShopShippingFees } from "@/lib/shipping-fee";
import { useLocalization } from "@/context/localization-context";

type CartItem = {
  id: string;
  quantity: number;
  cards: {
    id: string;
    name: string;
    image_url: string | null;
    category: string;
    condition: string | null;
    price: number | null;
    status: string;
    listing_type: string | null;
    seller_id: string;
    profiles?: {
      display_name?: string | null;
      profile_image_url?: string | null;
      shipping_carriers?: string[] | null;
      shipping_fees?: ShopShippingFees | null;
    } | null;
  } | null;
};

type SellerGroup = {
  id: string;
  name: string;
  avatarUrl: string | null;
  items: CartItem[];
};

const formatVND = (amount: number) => new Intl.NumberFormat("vi-VN").format(amount) + " đ";

export default function CartPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const copy = locale === "vi-VN"
    ? {
      loadCartError: "Không thể tải giỏ hàng",
      cartErrorTitle: "Lỗi giỏ hàng",
      removeError: "Không thể xóa sản phẩm",
      errorTitle: "Lỗi",
      title: "Giỏ hàng",
      subtitle: "Kiểm tra thẻ trước khi thanh toán an toàn trên CardVerseHub.",
      continueShopping: "Tiếp tục mua",
      emptyTitle: "Giỏ hàng đang trống",
      emptyHint: "Thêm thẻ từ trang Buy hoặc trang chi tiết để bắt đầu.",
      goShopping: "Đi mua thẻ",
      selectAll: "Chọn tất cả",
      selectForPayment: "Chọn sản phẩm để thanh toán",
      unavailable: "Không còn khả dụng",
      checkoutable: "Có thể checkout",
      missingCard: "Sản phẩm không tồn tại",
      sellerFallback: "Seller trên CardVerseHub",
      cardVerseSeller: "CardVerseHub seller",
      ship: "Ship",
      ghnReady: "GHN ready",
      payment: "Thanh toán",
      walletPayos: "Ví / PayOS",
      protection: "Bảo vệ",
      protected: "CardVerseHub giữ tiền",
      itemPrice: "Giá thẻ",
      shippingAtCheckout: "Phí ship tính ở checkout",
      viewDetail: "Xem chi tiết",
      removeFromCart: "Xóa khỏi giỏ",
      orderSummary: "Tóm tắt đơn hàng",
      selectedForPayment: "Đã chọn thanh toán",
      unavailableCount: "Không khả dụng",
      subtotal: "Tạm tính",
      shippingNote: "Phí ship tạm tính theo bảng giá của shop. Số chính xác được tính ở checkout theo địa chỉ nhận hàng.",
      total: "Thành tiền",
      checkout: "Thanh toán",
    }
    : locale === "ja-JP"
      ? {
        loadCartError: "カートを読み込めません",
        cartErrorTitle: "カートエラー",
        removeError: "商品を削除できません",
        errorTitle: "エラー",
        title: "ショッピングカート",
        subtitle: "CardVerseHubで安全に支払う前にカードを確認してください。",
        continueShopping: "買い物を続ける",
        emptyTitle: "カートは空です",
        emptyHint: "Buyページまたはカードページからカードを追加してください。",
        goShopping: "カードを探す",
        selectAll: "すべて選択",
        selectForPayment: "支払う商品を選択",
        unavailable: "在庫なし",
        checkoutable: "購入可能",
        missingCard: "商品が存在しません",
        sellerFallback: "CardVerseHubの販売者",
        cardVerseSeller: "CardVerseHub販売者",
        ship: "配送",
        ghnReady: "GHN対応",
        payment: "支払い",
        walletPayos: "ウォレット / PayOS",
        protection: "保護",
        protected: "CardVerseHubが代金を保持",
        itemPrice: "商品価格",
        shippingAtCheckout: "送料はチェックアウトで計算",
        viewDetail: "詳細を見る",
        removeFromCart: "カートから削除",
        orderSummary: "注文概要",
        selectedForPayment: "支払い対象",
        unavailableCount: "在庫なし",
        subtotal: "小計",
        shippingNote: "送料はショップの料金表に基づく目安です。正確な金額はチェックアウトで配送先住所に基づき計算されます。",
        total: "合計",
        checkout: "支払う",
      }
      : {
        loadCartError: "Unable to load cart",
        cartErrorTitle: "Cart error",
        removeError: "Unable to remove item",
        errorTitle: "Error",
        title: "Shopping cart",
        subtitle: "Review your cards before paying safely on CardVerseHub.",
        continueShopping: "Continue shopping",
        emptyTitle: "Your cart is empty",
        emptyHint: "Add cards from the Buy page or a card detail page to get started.",
        goShopping: "Browse cards",
        selectAll: "Select all",
        selectForPayment: "Select item for checkout",
        unavailable: "No longer available",
        checkoutable: "Ready to checkout",
        missingCard: "Item no longer exists",
        sellerFallback: "Seller on CardVerseHub",
        cardVerseSeller: "CardVerseHub seller",
        ship: "Ship",
        ghnReady: "GHN ready",
        payment: "Payment",
        walletPayos: "Wallet / PayOS",
        protection: "Protection",
        protected: "CardVerseHub held",
        itemPrice: "Item price",
        shippingAtCheckout: "Shipping calculated at checkout",
        viewDetail: "View detail",
        removeFromCart: "Remove from cart",
        orderSummary: "Order summary",
        selectedForPayment: "Selected for checkout",
        unavailableCount: "Unavailable",
        subtotal: "Subtotal",
        shippingNote: "Shipping is an estimate from the shop's rate table. The exact fee is calculated at checkout based on your delivery address.",
        total: "Total",
        checkout: "Checkout",
      };
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Shopee/TikTok-style selection: only checked items go to checkout.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchCart = useCallback(async () => {
    if (!user) return;
    setIsLoadingCart(true);
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.loadCartError);
      const nextItems: CartItem[] = data.items || [];
      setItems(nextItems);
      // Default: pre-select every available item so one-click checkout still works.
      setSelectedIds(new Set(
        nextItems
          .filter(item => item.cards?.status === "active" && item.cards?.listing_type === "sale")
          .map(item => item.id),
      ));
    } catch (error: any) {
      toast({ variant: "destructive", title: copy.cartErrorTitle, description: error.message });
    } finally {
      setIsLoadingCart(false);
    }
  }, [copy.cartErrorTitle, copy.loadCartError, toast, user]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setIsLoadingCart(false);
      setAuthOpen(true);
      return;
    }
    void fetchCart();
  }, [fetchCart, isLoading, setAuthOpen, user]);

  const availableItems = items.filter(item => item.cards?.status === "active" && item.cards?.listing_type === "sale");
  const unavailableItems = items.filter(item => !item.cards || item.cards.status !== "active" || item.cards.listing_type !== "sale");
  const selectedItems = availableItems.filter(item => selectedIds.has(item.id));
  const allSelected = availableItems.length > 0 && selectedItems.length === availableItems.length;
  const subtotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + Number(item.cards?.price || 0) * (item.quantity || 1), 0),
    [selectedItems],
  );
  // Estimated shipping across selected items (seller-declared range; the exact
  // tier fee is resolved from the buyer's address at checkout).
  const shipEstimate = useMemo(() => {
    let min = 0, max = 0, hasAny = false;
    selectedItems.forEach(item => {
      const r = shopShippingRange(item.cards?.profiles?.shipping_fees, item.cards?.profiles?.shipping_carriers);
      if (r) { min += r.min; max += r.max; hasAny = true; }
    });
    return hasAny ? { min, max } : null;
  }, [selectedItems]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(availableItems.map(item => item.id)));
  };

  const removeItem = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/cart/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.removeError);
      setItems(prev => prev.filter(item => item.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      window.dispatchEvent(new Event("cardverse:cart-updated"));
    } catch (error: any) {
      toast({ variant: "destructive", title: copy.errorTitle, description: error.message });
    } finally {
      setRemovingId(null);
    }
  };

  const estShippingLabel = locale === "vi-VN" ? "Phí ship tạm tính" : locale === "ja-JP" ? "送料（目安）" : "Est. shipping";
  const shippingTBD = locale === "vi-VN" ? "Tính khi nhập địa chỉ" : locale === "ja-JP" ? "住所入力時に計算" : "At checkout";
  const shipText = (range: { min: number; max: number } | null) =>
    !range ? shippingTBD : range.min === range.max ? formatVND(range.min) : `${formatVND(range.min)} – ${formatVND(range.max)}`;
  const totalText = shipEstimate
    ? `${formatVND(subtotal + shipEstimate.min)}${shipEstimate.min === shipEstimate.max ? "" : ` – ${formatVND(subtotal + shipEstimate.max)}`}`
    : formatVND(subtotal);
  const sellerGroups = useMemo(() => {
    const groups = new Map<string, SellerGroup>();

    items.forEach(item => {
      const card = item.cards;
      const sellerId = card?.seller_id || `missing-seller-${item.id}`;
      const profile = card?.profiles;
      const group = groups.get(sellerId);

      if (group) {
        group.items.push(item);
        return;
      }

      groups.set(sellerId, {
        id: sellerId,
        name: profile?.display_name || copy.sellerFallback,
        avatarUrl: profile?.profile_image_url || null,
        items: [item],
      });
    });

    return [...groups.values()];
  }, [copy.sellerFallback, items]);

  const toggleSellerGroup = (groupItems: CartItem[]) => {
    const groupAvailableIds = groupItems
      .filter(item => item.cards?.status === "active" && item.cards?.listing_type === "sale")
      .map(item => item.id);
    const groupIsSelected = groupAvailableIds.length > 0 && groupAvailableIds.every(id => selectedIds.has(id));

    setSelectedIds(prev => {
      const next = new Set(prev);
      groupAvailableIds.forEach(id => {
        if (groupIsSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-normal">{copy.title}</h1>
            <p className="text-muted-foreground">{copy.subtitle}</p>
          </div>
          <Button variant="outline" onClick={() => router.push("/buy")}>{copy.continueShopping}</Button>
        </div>

        {isLoadingCart ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
            </div>
            <Skeleton className="h-80 rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{copy.emptyTitle}</h2>
            <p className="mt-2 text-muted-foreground">{copy.emptyHint}</p>
            <Button className="mt-6 bg-orange-500 text-white hover:bg-orange-600" onClick={() => router.push("/buy")}>
              {copy.goShopping}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="space-y-4 sm:hidden">
                {sellerGroups.map(group => {
                  const groupAvailable = group.items.filter(item => item.cards?.status === "active" && item.cards?.listing_type === "sale");
                  const groupSelectedCount = groupAvailable.filter(item => selectedIds.has(item.id)).length;
                  const groupSelected = groupAvailable.length > 0 && groupSelectedCount === groupAvailable.length;

                  return (
                    <section key={group.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-card">
                      <header className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                        <Checkbox
                          checked={groupSelected}
                          disabled={groupAvailable.length === 0}
                          onCheckedChange={() => toggleSellerGroup(group.items)}
                          aria-label={`${copy.selectAll} ${group.name}`}
                          className="h-4 w-4"
                        />
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-500/15 text-[10px] font-bold text-orange-300">
                          {group.avatarUrl ? (
                            <Image src={group.avatarUrl} alt="" width={24} height={24} className="h-full w-full object-cover" />
                          ) : (
                            group.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className="min-w-0 truncate text-sm font-medium">{group.name}</span>
                        <span className="ml-auto shrink-0 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-300">
                          {copy.cardVerseSeller}
                        </span>
                      </header>

                      {group.items.map(item => {
                        const card = item.cards;
                        const unavailable = !card || card.status !== "active" || card.listing_type !== "sale";
                        const selected = selectedIds.has(item.id);
                        const shipRange = shopShippingRange(card?.profiles?.shipping_fees, card?.profiles?.shipping_carriers);

                        return (
                          <article key={item.id} className={`flex gap-3 border-b border-zinc-800 px-3 py-3 last:border-b-0 ${unavailable ? "opacity-60" : ""} ${selected ? "bg-orange-500/5" : ""}`}>
                            <div className="shrink-0 pt-1">
                              <Checkbox
                                checked={selected}
                                disabled={unavailable}
                                onCheckedChange={() => toggleItem(item.id)}
                                aria-label={copy.selectForPayment}
                                className="h-5 w-5"
                              />
                            </div>
                            <div className="relative w-24 shrink-0 self-start overflow-hidden rounded-lg bg-zinc-900 aspect-[3/4]">
                              {card?.image_url ? (
                                <Image src={optimizeCloudinaryUrl(card.image_url, 420)} alt={card.name} fill className="object-cover" />
                              ) : null}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <h2 className="line-clamp-2 text-sm font-semibold tracking-normal text-foreground">
                                {card?.name || copy.missingCard}
                              </h2>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{getCategoryCode(card?.category)}</span>
                                {card?.condition && (
                                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">{card.condition}</span>
                                )}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${unavailable ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                                  {unavailable ? copy.unavailable : copy.checkoutable}
                                </span>
                              </div>
                              <p className="mt-2 text-base font-bold text-orange-500">{formatVND(Number(card?.price || 0))}</p>
                              <div className="mt-2 flex items-center gap-3">
                                {card && (
                                  <button type="button" className="text-xs text-orange-300 hover:text-orange-200" onClick={() => router.push(`/cards/${card.id}`)}>
                                    {copy.viewDetail}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={removingId === item.id}
                                  onClick={() => removeItem(item.id)}
                                >
                                  {copy.removeFromCart}
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3 text-orange-300" />{estShippingLabel}: {shipText(shipRange)}</span>
                                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-400" />{copy.protected}</span>
                                <span className="inline-flex items-center gap-1"><CreditCard className="h-3 w-3 text-orange-300" />{copy.walletPayos}</span>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  );
                })}
              </section>

              <section className="hidden space-y-4 sm:block">
                {availableItems.length > 0 && (
                  <label className="flex w-fit cursor-pointer items-center gap-3 rounded-lg border bg-card/70 px-4 py-2.5 text-sm font-medium transition hover:border-orange-500/40">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                    {copy.selectAll} ({selectedItems.length}/{availableItems.length})
                  </label>
                )}
                {sellerGroups.map(group => {
                  const groupAvailable = group.items.filter(item => item.cards?.status === "active" && item.cards?.listing_type === "sale");
                  const groupSelected = groupAvailable.length > 0 && groupAvailable.every(item => selectedIds.has(item.id));

                  return (
                    <section key={group.id} className="overflow-hidden rounded-xl border bg-card">
                      <header className="flex items-center gap-3 border-b bg-zinc-900/50 px-4 py-3">
                        <Checkbox
                          checked={groupSelected}
                          disabled={groupAvailable.length === 0}
                          onCheckedChange={() => toggleSellerGroup(group.items)}
                          aria-label={`${copy.selectAll} ${group.name}`}
                        />
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-500/15 text-xs font-bold text-orange-300">
                          {group.avatarUrl ? (
                            <Image src={group.avatarUrl} alt="" width={32} height={32} className="h-full w-full object-cover" />
                          ) : (
                            group.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className="min-w-0 truncate text-sm font-semibold">{group.name}</span>
                        <span className="ml-auto shrink-0 rounded-md bg-orange-500/15 px-2 py-1 text-xs font-medium text-orange-300">
                          {copy.cardVerseSeller}
                        </span>
                      </header>
                      {group.items.map(item => {
                  const card = item.cards;
                  const unavailable = !card || card.status !== "active" || card.listing_type !== "sale";
                  const selected = selectedIds.has(item.id);
                  const shipRange = shopShippingRange(card?.profiles?.shipping_fees, card?.profiles?.shipping_carriers);
                  return (
                    <article key={item.id} className={`group relative flex border-b border-zinc-800 bg-card/60 transition last:border-b-0 hover:bg-card ${unavailable ? "opacity-60" : ""} ${selected ? "bg-orange-500/5" : ""}`}>
                      <div className="absolute left-3 top-3 z-10">
                        <Checkbox checked={selected} disabled={unavailable} onCheckedChange={() => toggleItem(item.id)} aria-label={copy.selectForPayment} className="h-5 w-5 border-white/40 bg-background/80 backdrop-blur" />
                      </div>
                      <div className="relative flex w-40 shrink-0 items-center justify-center bg-gradient-to-br from-zinc-900 to-black p-4">
                        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                          {card?.image_url ? <Image src={optimizeCloudinaryUrl(card.image_url, 420)} alt={card.name} fill className="object-cover" /> : null}
                        </div>
                        <span className="absolute right-3 top-3 rounded-md bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">{getCategoryCode(card?.category)}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col p-5">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${unavailable ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"}`}>{unavailable ? copy.unavailable : copy.checkoutable}</span>
                          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-muted-foreground">Qty {item.quantity || 1}</span>
                          {card?.condition && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-muted-foreground">{card.condition}</span>}
                        </div>
                        <h2 className="line-clamp-2 text-xl font-bold tracking-normal text-foreground">{card?.name || copy.missingCard}</h2>
                        <div className="mt-3 flex items-center gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orange-500/15 text-sm font-bold text-orange-300">
                            {card?.profiles?.profile_image_url ? <Image src={card.profiles.profile_image_url} alt="" width={36} height={36} className="h-full w-full object-cover" /> : (card?.profiles?.display_name || "S").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0"><p className="truncate text-sm font-semibold">{card?.profiles?.display_name || copy.sellerFallback}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="h-3 w-3" />{copy.cardVerseSeller}</p></div>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />{copy.protected}</span>
                          <span className="inline-flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-orange-300" />{copy.walletPayos}</span>
                        </div>
                      </div>
                      <div className="flex w-52 flex-col justify-between gap-3 border-l bg-background/30 p-5">
                        <div className="space-y-2.5"><div><p className="text-xs text-muted-foreground">{copy.itemPrice}</p><p className="text-2xl font-bold tracking-normal text-orange-400">{formatVND(Number(card?.price || 0))}</p></div><div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2"><p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Truck className="h-3.5 w-3.5 text-orange-300" />{estShippingLabel}</p><p className="mt-0.5 text-sm font-semibold text-foreground">{shipText(shipRange)}</p></div></div>
                        <div className="grid gap-2">
                          {card && <Button variant="outline" size="sm" className="justify-center gap-2 border-orange-500/35 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20" onClick={() => router.push(`/cards/${card.id}`)}><Eye className="h-4 w-4" />{copy.viewDetail}</Button>}
                          <Button variant="ghost" size="sm" className="justify-center gap-2 text-muted-foreground hover:text-red-300" disabled={removingId === item.id} onClick={() => removeItem(item.id)}><Trash2 className="h-4 w-4" />{copy.removeFromCart}</Button>
                        </div>
                      </div>
                    </article>
                  );
                      })}
                    </section>
                  );
                })}
              </section>

              <aside className="hidden sm:block lg:sticky lg:top-32 lg:self-start">
              <div className="rounded-xl border bg-card p-5 shadow-[0_20px_80px_rgba(0,0,0,0.24)]">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-orange-400" />
                  <h2 className="text-xl font-semibold">{copy.orderSummary}</h2>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{copy.selectedForPayment}</span>
                    <span>{selectedItems.length}/{availableItems.length}</span>
                  </div>
                  {unavailableItems.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{copy.unavailableCount}</span>
                      <span>{unavailableItems.length}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{copy.subtotal}</span>
                    <span className="whitespace-nowrap font-semibold">{formatVND(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">{estShippingLabel}</span>
                    <span className="whitespace-nowrap font-semibold">{shipText(shipEstimate)}</span>
                  </div>
                  <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-3 text-xs text-orange-200">
                    {copy.shippingNote}
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-muted-foreground">{copy.total}</span>
                      <span className="overflow-x-auto whitespace-nowrap text-lg font-bold text-orange-400 sm:text-xl">{totalText}</span>
                    </div>
                  </div>
                </div>
                <Button
                  className="mt-5 h-12 w-full bg-orange-500 font-bold text-white hover:bg-orange-600"
                  disabled={selectedItems.length === 0}
                  onClick={() => router.push(`/checkout?mode=cart&items=${selectedItems.map(item => item.id).join(",")}`)}
                >
                  {copy.checkout} ({selectedItems.length}) <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              </aside>
            </div>

            <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur sm:hidden">
              <div className="flex items-start justify-between gap-2">
                <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs font-medium">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span>{copy.selectAll} ({selectedItems.length}/{availableItems.length})</span>
                </label>
                <div className="min-w-0 flex-1 text-right">
                  <p className="text-[10px] text-muted-foreground">{copy.total}</p>
                  <p className="mt-0.5 break-words text-sm font-bold leading-4 text-orange-500">{totalText}</p>
                  <p className="mt-1 text-[10px] leading-3 text-muted-foreground">{estShippingLabel}: {shipText(shipEstimate)}</p>
                </div>
              </div>
              <Button
                className="mt-3 h-11 w-full rounded-lg bg-orange-500 py-3 text-sm font-semibold text-white hover:bg-orange-600"
                disabled={selectedItems.length === 0}
                onClick={() => router.push(`/checkout?mode=cart&items=${selectedItems.map(item => item.id).join(",")}`)}
              >
                {copy.checkout} ({selectedItems.length})
              </Button>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
