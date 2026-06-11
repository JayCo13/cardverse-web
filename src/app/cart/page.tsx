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
    } | null;
  } | null;
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
        subtitle: "Kiểm tra thẻ trước khi thanh toán an toàn trên CardVerse.",
        continueShopping: "Tiếp tục mua",
        emptyTitle: "Giỏ hàng đang trống",
        emptyHint: "Thêm thẻ từ trang Buy hoặc trang chi tiết để bắt đầu.",
        goShopping: "Đi mua thẻ",
        selectAll: "Chọn tất cả",
        selectForPayment: "Chọn sản phẩm để thanh toán",
        unavailable: "Không còn khả dụng",
        checkoutable: "Có thể checkout",
        missingCard: "Sản phẩm không tồn tại",
        sellerFallback: "Seller trên CardVerse",
        cardVerseSeller: "CardVerse seller",
        ship: "Ship",
        ghnReady: "GHN ready",
        payment: "Thanh toán",
        walletPayos: "Ví / PayOS",
        protection: "Bảo vệ",
        protected: "CardVerse giữ tiền",
        itemPrice: "Giá thẻ",
        shippingAtCheckout: "Phí ship tính ở checkout",
        viewDetail: "Xem chi tiết",
        removeFromCart: "Xóa khỏi giỏ",
        orderSummary: "Tóm tắt đơn hàng",
        selectedForPayment: "Đã chọn thanh toán",
        unavailableCount: "Không khả dụng",
        subtotal: "Tạm tính",
        shippingNote: "Phí ship GHN sẽ được tính ở trang checkout theo địa chỉ nhận hàng.",
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
          subtitle: "CardVerseで安全に支払う前にカードを確認してください。",
          continueShopping: "買い物を続ける",
          emptyTitle: "カートは空です",
          emptyHint: "Buyページまたはカードページからカードを追加してください。",
          goShopping: "カードを探す",
          selectAll: "すべて選択",
          selectForPayment: "支払う商品を選択",
          unavailable: "在庫なし",
          checkoutable: "購入可能",
          missingCard: "商品が存在しません",
          sellerFallback: "CardVerseの販売者",
          cardVerseSeller: "CardVerse販売者",
          ship: "配送",
          ghnReady: "GHN対応",
          payment: "支払い",
          walletPayos: "ウォレット / PayOS",
          protection: "保護",
          protected: "CardVerseが代金を保持",
          itemPrice: "商品価格",
          shippingAtCheckout: "送料はチェックアウトで計算",
          viewDetail: "詳細を見る",
          removeFromCart: "カートから削除",
          orderSummary: "注文概要",
          selectedForPayment: "支払い対象",
          unavailableCount: "在庫なし",
          subtotal: "小計",
          shippingNote: "GHN送料はチェックアウトページで配送先住所に基づいて計算されます。",
          total: "合計",
          checkout: "支払う",
        }
      : {
          loadCartError: "Unable to load cart",
          cartErrorTitle: "Cart error",
          removeError: "Unable to remove item",
          errorTitle: "Error",
          title: "Shopping cart",
          subtitle: "Review your cards before paying safely on CardVerse.",
          continueShopping: "Continue shopping",
          emptyTitle: "Your cart is empty",
          emptyHint: "Add cards from the Buy page or a card detail page to get started.",
          goShopping: "Browse cards",
          selectAll: "Select all",
          selectForPayment: "Select item for checkout",
          unavailable: "No longer available",
          checkoutable: "Ready to checkout",
          missingCard: "Item no longer exists",
          sellerFallback: "Seller on CardVerse",
          cardVerseSeller: "CardVerse seller",
          ship: "Ship",
          ghnReady: "GHN ready",
          payment: "Payment",
          walletPayos: "Wallet / PayOS",
          protection: "Protection",
          protected: "CardVerse held",
          itemPrice: "Item price",
          shippingAtCheckout: "Shipping calculated at checkout",
          viewDetail: "View detail",
          removeFromCart: "Remove from cart",
          orderSummary: "Order summary",
          selectedForPayment: "Selected for checkout",
          unavailableCount: "Unavailable",
          subtotal: "Subtotal",
          shippingNote: "GHN shipping is calculated at checkout based on your delivery address.",
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
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="space-y-4">
              {availableItems.length > 0 && (
                <label className="flex w-fit cursor-pointer items-center gap-3 rounded-lg border bg-card/70 px-4 py-2.5 text-sm font-medium transition hover:border-orange-500/40">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  {copy.selectAll} ({selectedItems.length}/{availableItems.length})
                </label>
              )}
              {items.map(item => {
                const card = item.cards;
                const unavailable = !card || card.status !== "active" || card.listing_type !== "sale";
                const selected = selectedIds.has(item.id);
                return (
                  <article
                    key={item.id}
                    className={`group overflow-hidden rounded-xl border bg-card/70 shadow-[0_18px_70px_rgba(0,0,0,0.22)] transition hover:border-orange-500/40 hover:bg-card md:grid md:grid-cols-[44px_168px_minmax(0,1fr)_230px] ${unavailable ? "opacity-60" : ""} ${selected ? "border-orange-500/50" : ""}`}
                  >
                    <div className="flex items-start justify-center border-b p-3 pt-5 md:border-b-0 md:border-r md:pt-6">
                      <Checkbox
                        checked={selected}
                        disabled={unavailable}
                        onCheckedChange={() => toggleItem(item.id)}
                        aria-label={copy.selectForPayment}
                      />
                    </div>
                    <div className="relative min-h-[220px] bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 md:min-h-full">
                      <div className="relative mx-auto aspect-[3/4] h-full max-h-[230px] w-[150px] overflow-hidden rounded-lg border border-white/10 bg-muted shadow-[0_20px_55px_rgba(0,0,0,0.45)]">
                        {card?.image_url ? (
                          <Image src={optimizeCloudinaryUrl(card.image_url, 420)} alt={card.name} fill className="object-cover" />
                        ) : null}
                      </div>
                      <span className="absolute left-4 top-4 rounded-md border border-orange-400/50 bg-orange-500/90 px-2 py-1 text-[11px] font-bold text-white shadow-lg">
                        {card?.category || "CARD"}
                      </span>
                    </div>

                    <div className="min-w-0 p-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          Qty {item.quantity || 1}
                        </span>
                        {unavailable ? (
                          <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300">
                            {copy.unavailable}
                          </span>
                        ) : (
                          <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                            {copy.checkoutable}
                          </span>
                        )}
                      </div>

                      <h2 className="line-clamp-2 text-2xl font-bold tracking-normal text-foreground">
                        {card?.name || copy.missingCard}
                      </h2>

                      <div className="mt-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orange-500/15 text-sm font-bold text-orange-300">
                          {card?.profiles?.profile_image_url ? (
                            <Image src={card.profiles.profile_image_url} alt="" width={40} height={40} className="h-full w-full object-cover" />
                          ) : (
                            (card?.profiles?.display_name || "S").charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{card?.profiles?.display_name || copy.sellerFallback}</p>
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Store className="h-3.5 w-3.5" />
                            {copy.cardVerseSeller}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
                        <div className="rounded-lg border border-white/10 bg-background/55 p-3">
                          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                            <Truck className="h-4 w-4 text-orange-300" />
                            {copy.ship}
                          </div>
                          <p className="font-semibold">{copy.ghnReady}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-background/55 p-3">
                          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                            <CreditCard className="h-4 w-4 text-orange-300" />
                            {copy.payment}
                          </div>
                          <p className="font-semibold">{copy.walletPayos}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-background/55 p-3">
                          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                            <PackageCheck className="h-4 w-4 text-orange-300" />
                            {copy.protection}
                          </div>
                          <p className="font-semibold">{copy.protected}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col justify-between gap-4 border-t p-5 md:border-l md:border-t-0">
                      <div className="space-y-1 md:text-right">
                        <p className="text-sm text-muted-foreground">{copy.itemPrice}</p>
                        <p className="text-3xl font-bold tracking-normal text-orange-400 md:text-2xl">
                          {formatVND(Number(card?.price || 0))}
                        </p>
                        <p className="text-sm font-medium text-amber-300">{copy.shippingAtCheckout}</p>
                      </div>
                      <div className="grid gap-2">
                        {card && (
                          <Button
                            variant="outline"
                            className="h-11 justify-center gap-2 border-orange-500/35 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20"
                            onClick={() => router.push(`/cards/${card.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                            {copy.viewDetail}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="h-11 justify-center gap-2 text-muted-foreground hover:text-red-300"
                          disabled={removingId === item.id}
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {copy.removeFromCart}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            <aside className="lg:sticky lg:top-32 lg:self-start">
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
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{copy.subtotal}</span>
                    <span className="font-semibold">{formatVND(subtotal)}</span>
                  </div>
                  <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-3 text-xs text-orange-200">
                    {copy.shippingNote}
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>{copy.total}</span>
                      <span className="text-orange-400">{formatVND(subtotal)}</span>
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
        )}
      </main>
      <Footer />
    </div>
  );
}
