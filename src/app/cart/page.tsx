"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth, useSupabase } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { OrderTotalRow } from "@/components/order-total-row";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Clock, CreditCard, Eye, PackageCheck, ShieldCheck, ShoppingCart, Store, Trash2, Truck } from "lucide-react";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCategoryCode } from "@/lib/category-code";
import { shopShippingRange, type ShopShippingFees } from "@/lib/shipping-fee";
import { useLocalization } from "@/context/localization-context";
import { VerifiedSellerBadge } from "@/components/verified-seller-badge";

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
      seller_verified?: boolean | null;
      shipping_carriers?: string[] | null;
      shipping_fees?: ShopShippingFees | null;
    } | null;
  } | null;
};

/** What the confirmation dialog is currently asking about. */
type PendingRemoval =
  | { kind: "one"; id: string; name: string }
  | { kind: "selected" }
  | { kind: "all" };

type SellerGroup = {
  id: string;
  name: string;
  avatarUrl: string | null;
  items: CartItem[];
};

const formatVND = (amount: number) =>
  // Non-breaking space: the currency mark must never wrap away from its number.
  new Intl.NumberFormat("vi-VN").format(amount) + "\u00A0đ";

export default function CartPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const supabase = useSupabase();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const copy = locale === "vi-VN"
    ? {
      loadCartError: "Không thể tải giỏ hàng",
      cartErrorTitle: "Lỗi giỏ hàng",
      removeError: "Không thể xóa sản phẩm",
      errorTitle: "Lỗi",
      awaitingTitle: "Chờ thanh toán",
      awaitingHint: "Người bán đã chấp nhận lời trả giá của bạn. Thẻ được giữ đến hạn dưới đây; quá hạn thẻ sẽ trở lại chợ và điểm uy tín của bạn bị trừ.",
      awaitingPay: "Thanh toán ngay",
      awaitingDeadline: "Giữ đến {when}",
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
      removeSelected: "Xóa mục đã chọn",
      emptyCart: "Xóa tất cả",
      removedCount: "Đã xóa khỏi giỏ:",
      confirmRemoveOneTitle: "Xóa thẻ này khỏi giỏ?",
      confirmRemoveSelectedTitle: "Xóa các mục đã chọn?",
      confirmEmptyCartTitle: "Xóa toàn bộ giỏ hàng?",
      confirmRemoveBody: "Thao tác này không hoàn tác được. Thẻ vẫn còn trên chợ, bạn có thể thêm lại sau.",
      confirmRemove: "Xóa",
      cancel: "Hủy",
    }
    : locale === "ja-JP"
      ? {
        loadCartError: "カートを読み込めません",
        cartErrorTitle: "カートエラー",
        removeError: "商品を削除できません",
        errorTitle: "エラー",
        awaitingTitle: "支払い待ち",
        awaitingHint: "販売者があなたのオファーを承諾しました。下記の期限までカードを確保しています。期限を過ぎるとカードは出品に戻り、信頼スコアが下がります。",
        awaitingPay: "今すぐ支払う",
        awaitingDeadline: "{when} まで確保",
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
        removeSelected: "選択した商品を削除",
        emptyCart: "すべて削除",
        removedCount: "カートから削除しました:",
        confirmRemoveOneTitle: "このカードをカートから削除しますか？",
        confirmRemoveSelectedTitle: "選択した商品を削除しますか？",
        confirmEmptyCartTitle: "カートを空にしますか？",
        confirmRemoveBody: "この操作は取り消せません。カードは出品されたままなので、後で追加し直せます。",
        confirmRemove: "削除",
        cancel: "キャンセル",
      }
      : {
        loadCartError: "Unable to load cart",
        cartErrorTitle: "Cart error",
        removeError: "Unable to remove item",
        errorTitle: "Error",
        awaitingTitle: "Awaiting payment",
        awaitingHint: "The seller accepted your offer. The card is held until the deadline below; after that it returns to the marketplace and your trust score takes a hit.",
        awaitingPay: "Pay now",
        awaitingDeadline: "Held until {when}",
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
        removeSelected: "Remove selected",
        emptyCart: "Empty cart",
        removedCount: "Removed from cart:",
        confirmRemoveOneTitle: "Remove this card from your cart?",
        confirmRemoveSelectedTitle: "Remove the selected cards?",
        confirmEmptyCartTitle: "Empty your cart?",
        confirmRemoveBody: "This cannot be undone. The cards stay listed on the marketplace, so you can add them back later.",
        confirmRemove: "Remove",
        cancel: "Cancel",
      };
  const [items, setItems] = useState<CartItem[]>([]);

  /**
   * Offers the seller accepted, which are not cart items and never were.
   *
   * Accepting an offer takes the card off the marketplace and reserves it, but
   * the only route to paying was a button inside the chat drawer — so a buyer
   * who closed the chat had nowhere to find it. This is the page they look on.
   */
  const [awaitingPayment, setAwaitingPayment] = useState<Array<{
    id: string;
    price: number;
    cardName: string;
    cardImage: string | null;
    deadline: string | null;
  }>>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);

  // Shopee/TikTok-style selection: only checked items go to checkout.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);

  const fetchCart = useCallback(async () => {
    if (!user) return;
    setIsLoadingCart(true);
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.loadCartError);
      const nextItems: CartItem[] = data.items || [];
      setItems(nextItems);
      // Nothing is pre-selected: the buyer says what they are paying for, so a
      // stray tap on Checkout cannot sweep in cards they had parked for later.
      setSelectedIds(new Set());
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

  useEffect(() => {
    if (!user) { setAwaitingPayment([]); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('offers')
        .select('id, price, cards!inner(name, image_url, reserved_until, status)')
        .eq('buyer_id', user.id)
        .eq('status', 'chosen')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setAwaitingPayment(((data || []) as unknown as Array<{
        id: string; price: number;
        cards: { name: string; image_url: string | null; reserved_until: string | null; status: string } | null;
      }>)
        // A card the seller has since sold or delisted is not payable, and the
        // sweep will close the offer shortly — showing it would invite a click
        // into a checkout that cannot complete.
        .filter((row) => row.cards?.status === 'in_transaction')
        .map((row) => ({
          id: row.id,
          price: row.price,
          cardName: row.cards?.name || '',
          cardImage: row.cards?.image_url || null,
          deadline: row.cards?.reserved_until || null,
        })));
    })();
    return () => { cancelled = true; };
  }, [user, supabase]);

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

  /**
   * Every removal — one card, the selection, or the whole cart — is confirmed
   * first and then runs through here. Taking a card out is not undoable, and a
   * mis-tap on a phone is cheap to make and annoying to recover from.
   *
   * `null` means "empty the cart"; anything else is an explicit id list.
   */
  const removeMany = async (ids: string[] | null) => {
    setIsBulkRemoving(true);
    try {
      const res = await fetch("/api/cart", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || copy.removeError);

      const removed = new Set<string>(data.removed || []);
      setItems(prev => prev.filter(item => !removed.has(item.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        removed.forEach(id => next.delete(id));
        return next;
      });
      window.dispatchEvent(new Event("cardverse:cart-updated"));
      toast({ description: `${copy.removedCount} ${removed.size}` });
    } catch (error: any) {
      toast({ variant: "destructive", title: copy.errorTitle, description: error.message });
    } finally {
      setIsBulkRemoving(false);
      setPendingRemoval(null);
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

        {/* Above the cart and outside its empty state on purpose: an accepted
            offer is the most urgent thing on this page — it has a deadline the
            cart items do not — and the case that sent buyers looking here was an
            empty cart with a card held somewhere they could not see. */}
        {awaitingPayment.length > 0 && (
          <section className="mb-8 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-orange-400">
              <Clock className="h-5 w-5 shrink-0" />
              {copy.awaitingTitle}
              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-medium tabular-nums">
                {awaitingPayment.length}
              </span>
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{copy.awaitingHint}</p>

            <div className="mt-4 space-y-3">
              {awaitingPayment.map((offer) => (
                <div
                  key={offer.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center"
                >
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {offer.cardImage && (
                      <Image src={offer.cardImage} alt="" fill sizes="48px" className="object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{offer.cardName}</p>
                    <p className="text-sm font-semibold text-orange-400 tabular-nums">
                      {new Intl.NumberFormat("vi-VN").format(offer.price)}đ
                    </p>
                    {offer.deadline && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {copy.awaitingDeadline.replace(
                          "{when}",
                          new Date(offer.deadline).toLocaleString(locale, {
                            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                          }),
                        )}
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full shrink-0 bg-orange-500 text-white hover:bg-orange-600 sm:w-auto"
                    onClick={() => router.push(`/checkout?offerId=${offer.id}`)}
                  >
                    {copy.awaitingPay}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

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
                {/* The sticky bar at the bottom already carries select-all and the
                    total, with no room left, so the destructive pair lives above
                    the list where it cannot be hit by accident on the way to
                    Checkout. */}
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-red-400"
                    disabled={selectedItems.length === 0 || isBulkRemoving}
                    onClick={() => setPendingRemoval({ kind: "selected" })}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {copy.removeSelected} ({selectedItems.length})
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-red-400"
                    disabled={items.length === 0 || isBulkRemoving}
                    onClick={() => setPendingRemoval({ kind: "all" })}
                  >
                    {copy.emptyCart}
                  </Button>
                </div>
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
                            {/* Image and title open the card, the way a listing row
                                behaves everywhere else. That retires the "view
                                detail" text link, which read as body copy. */}
                            <button
                              type="button"
                              disabled={!card}
                              onClick={() => card && router.push(`/cards/${card.id}`)}
                              className="relative aspect-[3/4] w-24 shrink-0 self-start overflow-hidden rounded-lg bg-zinc-900 disabled:cursor-default"
                              aria-label={card ? `${copy.viewDetail}: ${card.name}` : copy.missingCard}
                            >
                              {card?.image_url ? (
                                <Image src={optimizeCloudinaryUrl(card.image_url, 420)} alt={card.name} fill className="object-cover" />
                              ) : null}
                            </button>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  disabled={!card}
                                  onClick={() => card && router.push(`/cards/${card.id}`)}
                                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                                >
                                  <h2 className="line-clamp-3 text-sm font-semibold leading-snug tracking-normal text-foreground">
                                    {card?.name || copy.missingCard}
                                  </h2>
                                </button>
                                {/* Destructive, so it keeps a full 44px target of
                                    its own in the corner, away from the tap that
                                    opens the card. */}
                                <button
                                  type="button"
                                  disabled={isBulkRemoving}
                                  onClick={() => setPendingRemoval({ kind: "one", id: item.id, name: card?.name || copy.missingCard })}
                                  aria-label={copy.removeFromCart}
                                  className="-mr-1.5 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-red-400 active:bg-red-500/10 disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
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
                              <div className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-1 text-[10px] leading-4 text-muted-foreground">
                                <span className="inline-flex items-start gap-1"><Truck className="mt-0.5 h-3 w-3 shrink-0 text-orange-300" />{estShippingLabel}: {shipText(shipRange)}</span>
                                <span className="inline-flex items-start gap-1"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />{copy.protected}</span>
                                <span className="inline-flex items-start gap-1"><CreditCard className="mt-0.5 h-3 w-3 shrink-0 text-orange-300" />{copy.walletPayos}</span>
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
                <div className="flex flex-wrap items-center gap-3">
                  {availableItems.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card/70 px-4 py-2.5 text-sm font-medium transition hover:border-orange-500/40">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                      {copy.selectAll} ({selectedItems.length}/{availableItems.length})
                    </label>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-red-400"
                      disabled={selectedItems.length === 0 || isBulkRemoving}
                      onClick={() => setPendingRemoval({ kind: "selected" })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {copy.removeSelected} ({selectedItems.length})
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-red-400"
                      disabled={items.length === 0 || isBulkRemoving}
                      onClick={() => setPendingRemoval({ kind: "all" })}
                    >
                      {copy.emptyCart}
                    </Button>
                  </div>
                </div>
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
                          <div className="min-w-0"><p className="flex min-w-0 items-center gap-1 text-sm font-semibold"><span className="truncate">{card?.profiles?.display_name || copy.sellerFallback}</span><VerifiedSellerBadge verified={card?.profiles?.seller_verified} className="h-3.5 w-3.5" /></p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="h-3 w-3" />{copy.cardVerseSeller}</p></div>
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
                          <Button variant="ghost" size="sm" className="justify-center gap-2 text-muted-foreground hover:text-red-300" disabled={isBulkRemoving} onClick={() => setPendingRemoval({ kind: "one", id: item.id, name: card?.name || copy.missingCard })}><Trash2 className="h-4 w-4" />{copy.removeFromCart}</Button>
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
                  <OrderTotalRow className="border-t pt-3" label={copy.total} amount={totalText} />
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

      <AlertDialog open={pendingRemoval !== null} onOpenChange={open => !open && setPendingRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemoval?.kind === "all"
                ? copy.confirmEmptyCartTitle
                : pendingRemoval?.kind === "one"
                  ? copy.confirmRemoveOneTitle
                  : copy.confirmRemoveSelectedTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval?.kind === "one" ? `${pendingRemoval.name} — ` : ""}
              {copy.confirmRemoveBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkRemoving}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkRemoving}
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={event => {
                // Keep the dialog up while the request runs; removeMany closes it.
                event.preventDefault();
                if (!pendingRemoval) return;
                void removeMany(
                  pendingRemoval.kind === "all" ? null
                    : pendingRemoval.kind === "one" ? [pendingRemoval.id]
                      : selectedItems.map(item => item.id),
                );
              }}
            >
              {copy.confirmRemove}
              {pendingRemoval?.kind === "selected" ? ` (${selectedItems.length})` : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
