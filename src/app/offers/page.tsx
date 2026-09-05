"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CheckCircle, CreditCard, HandCoins, Loader2,
  MessageCircle, Package, RefreshCw, X,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useSupabase } from "@/lib/supabase";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { VerifiedSellerBadge } from "@/components/verified-seller-badge";

type InboxView = "received" | "sent";
type StatusFilter = "all" | "pending" | "awaiting_payment" | "history";
type OfferStatus = "pending" | "accepted" | "rejected" | "chosen" | "expired";

type OfferItem = {
  id: string;
  cardId: string;
  buyerId: string;
  price: number;
  message: string | null;
  status: OfferStatus;
  transactionId: string | null;
  createdAt: string;
  conversationId: string | null;
  card: { id: string; name: string; imageUrl: string | null; price: number | null; status: string } | null;
  counterparty: { id: string; display_name: string | null; profile_image_url: string | null; seller_verified: boolean | null } | null;
  bundleSelection: { title?: string; price?: number }[] | null;
};

type InboxResponse = {
  items: OfferItem[];
  counts: { pending: number; awaitingPayment: number; history: number };
  nextCursor: string | null;
  selectedCard: OfferItem["card"];
};

type PendingAction = { offer: OfferItem; action: "accept" | "reject" } | null;

const formatVND = (value: number) => new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
}).format(value);

const initials = (value: string) => value.trim().slice(0, 2).toUpperCase() || "CV";

function OffersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocalization();
  const { user, profile, isLoading: authLoading } = useAuth();
  const supabase = useSupabase();
  const { toast } = useToast();
  const requestedView = searchParams.get("view");
  const cardId = searchParams.get("cardId") || "";
  const canReceive = Boolean(profile?.seller_verified || profile?.is_tester);
  const [view, setView] = useState<InboxView>(requestedView === "received" ? "received" : "sent");
  const [status, setStatus] = useState<StatusFilter>(requestedView === "received" ? "pending" : "all");
  const [items, setItems] = useState<OfferItem[]>([]);
  const [counts, setCounts] = useState({ pending: 0, awaitingPayment: 0, history: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [focusedCard, setFocusedCard] = useState<OfferItem["card"]>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionOfferId, setActionOfferId] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const actionKeys = useRef<Record<string, string>>({});

  const copy = locale === "vi-VN" ? {
    title: "Offer", subtitle: "Theo dõi offer đã gửi và xử lý offer bạn nhận được.",
    received: "Đã nhận", sent: "Đã gửi", pending: "Đang chờ", awaiting: "Chờ thanh toán", history: "Lịch sử", all: "Tất cả",
    pendingKpi: "Chờ phản hồi", awaitingKpi: "Chờ thanh toán", historyKpi: "Đã xử lý",
    empty: "Chưa có offer trong mục này.", loadFailed: "Không thể tải danh sách offer.", retry: "Thử lại", loadMore: "Xem thêm",
    buyer: "Người mua", seller: "Người bán", askingPrice: "Giá niêm yết", offered: "Giá đề nghị", offeredCards: "Thẻ được offer", viewCard: "Xem thẻ",
    message: "Nhắn tin", accept: "Chấp nhận", reject: "Từ chối", pay: "Thanh toán ngay",
    pendingStatus: "Đang chờ phản hồi", chosenStatus: "Đã chấp nhận — chờ thanh toán", acceptedStatus: "Đã chấp nhận",
    rejectedStatus: "Đã từ chối", expiredStatus: "Đã hết hạn", backAll: "Xem tất cả offer",
    acceptTitle: "Chấp nhận offer này?", acceptDesc: "Listing sẽ được giữ cho buyer này trong thời hạn thanh toán. Tất cả offer đang chờ khác của cùng thẻ sẽ tự động bị từ chối.",
    rejectTitle: "Từ chối offer này?", rejectDesc: "Buyer sẽ được thông báo và có thể gửi lại một offer cao hơn.", cancel: "Huỷ",
    actionFailed: "Không thể xử lý offer.", acceptedToast: "Đã chấp nhận offer", rejectedToast: "Đã từ chối offer",
    signIn: "Đăng nhập để xem offer", notSeller: "Bạn chưa có offer đã nhận. Tab này dành cho tài khoản bán hàng.",
  } : locale === "ja-JP" ? {
    title: "オファー", subtitle: "送信したオファーを確認し、受け取ったオファーを管理します。",
    received: "受信", sent: "送信済み", pending: "保留中", awaiting: "支払い待ち", history: "履歴", all: "すべて",
    pendingKpi: "返答待ち", awaitingKpi: "支払い待ち", historyKpi: "処理済み",
    empty: "この項目にオファーはありません。", loadFailed: "オファーを読み込めません。", retry: "再試行", loadMore: "さらに表示",
    buyer: "購入者", seller: "販売者", askingPrice: "販売価格", offered: "提示価格", offeredCards: "対象カード", viewCard: "カードを見る",
    message: "メッセージ", accept: "承認", reject: "拒否", pay: "今すぐ支払う",
    pendingStatus: "返答待ち", chosenStatus: "承認済み — 支払い待ち", acceptedStatus: "承認済み",
    rejectedStatus: "拒否済み", expiredStatus: "期限切れ", backAll: "すべてのオファーを見る",
    acceptTitle: "このオファーを承認しますか？", acceptDesc: "支払い期限までこの購入者のために出品が確保され、同じカードの他の保留中オファーは自動的に拒否されます。",
    rejectTitle: "このオファーを拒否しますか？", rejectDesc: "購入者に通知され、より高い価格で再提案できます。", cancel: "キャンセル",
    actionFailed: "オファーを処理できません。", acceptedToast: "オファーを承認しました", rejectedToast: "オファーを拒否しました",
    signIn: "ログインしてオファーを見る", notSeller: "受信したオファーはありません。このタブは販売者向けです。",
  } : {
    title: "Offers", subtitle: "Track offers you sent and manage offers you received.",
    received: "Received", sent: "Sent", pending: "Pending", awaiting: "Awaiting payment", history: "History", all: "All",
    pendingKpi: "Needs response", awaitingKpi: "Awaiting payment", historyKpi: "Resolved",
    empty: "There are no offers in this view.", loadFailed: "Unable to load offers.", retry: "Try again", loadMore: "Load more",
    buyer: "Buyer", seller: "Seller", askingPrice: "Asking price", offered: "Offer", offeredCards: "Cards offered on", viewCard: "View card",
    message: "Message", accept: "Accept", reject: "Reject", pay: "Pay now",
    pendingStatus: "Waiting for response", chosenStatus: "Accepted — awaiting payment", acceptedStatus: "Accepted",
    rejectedStatus: "Rejected", expiredStatus: "Expired", backAll: "View all offers",
    acceptTitle: "Accept this offer?", acceptDesc: "The listing will be reserved for this buyer during the payment window. Every other pending offer for the same card will be rejected automatically.",
    rejectTitle: "Reject this offer?", rejectDesc: "The buyer will be notified and may submit a higher offer.", cancel: "Cancel",
    actionFailed: "Unable to process the offer.", acceptedToast: "Offer accepted", rejectedToast: "Offer rejected",
    signIn: "Sign in to view offers", notSeller: "You have no received offers. This tab is for seller accounts.",
  };

  useEffect(() => {
    if (!requestedView && canReceive) {
      setView("received");
      setStatus("pending");
    }
  }, [canReceive, requestedView]);

  const loadOffers = useCallback(async (cursor?: string, append = false) => {
    if (!user) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    if (!append) setError(null);
    try {
      const params = new URLSearchParams({ view, status, limit: "20" });
      if (cardId) params.set("cardId", cardId);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/offers/inbox?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as InboxResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || copy.loadFailed);
      setItems(current => append ? [...current, ...payload.items] : payload.items);
      setCounts(payload.counts);
      setNextCursor(payload.nextCursor);
      if (!append) setFocusedCard(payload.selectedCard || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [cardId, copy.loadFailed, status, user, view]);

  useEffect(() => { void loadOffers(); }, [loadOffers]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      void loadOffers();
      window.dispatchEvent(new CustomEvent("cardverse:offers-updated"));
    };
    window.addEventListener("focus", refresh);
    const channel = supabase.channel(`offer-inbox-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, refresh)
      .subscribe();
    return () => {
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [loadOffers, supabase, user]);

  const changeView = (next: InboxView) => {
    setView(next);
    setStatus(next === "received" ? "pending" : "all");
    router.replace(`/offers?view=${next}`);
  };

  const statusText = (offerStatus: OfferStatus) => ({
    pending: copy.pendingStatus,
    chosen: copy.chosenStatus,
    accepted: copy.acceptedStatus,
    rejected: copy.rejectedStatus,
    expired: copy.expiredStatus,
  })[offerStatus];

  const statusClass = (offerStatus: OfferStatus) => offerStatus === "pending"
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : offerStatus === "chosen" || offerStatus === "accepted"
      ? "border-green-500/40 bg-green-500/10 text-green-300"
      : "border-white/10 bg-muted/30 text-muted-foreground";

  const openChat = async (offer: OfferItem) => {
    setOpeningChatId(offer.id);
    try {
      let conversationId = offer.conversationId;
      if (!conversationId) {
        const response = await fetch("/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: offer.cardId, offerId: offer.id }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || copy.actionFailed);
        conversationId = payload.conversation?.id || null;
      }
      if (!conversationId) throw new Error(copy.actionFailed);
      window.dispatchEvent(new CustomEvent("cardverse:open-chat", { detail: { conversationId } }));
    } catch (chatError) {
      toast({ variant: "destructive", title: copy.actionFailed, description: chatError instanceof Error ? chatError.message : copy.actionFailed });
    } finally {
      setOpeningChatId(null);
    }
  };

  const runAction = async () => {
    if (!pendingAction || actionOfferId) return;
    const { offer, action } = pendingAction;
    const fingerprint = `${offer.id}:${action}`;
    actionKeys.current[fingerprint] ||= crypto.randomUUID();
    setActionOfferId(offer.id);
    try {
      const response = await fetch(`/api/offers/${offer.id}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": actionKeys.current[fingerprint] },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.actionFailed);
      delete actionKeys.current[fingerprint];
      setPendingAction(null);
      toast({ title: action === "accept" ? copy.acceptedToast : copy.rejectedToast });
      window.dispatchEvent(new CustomEvent("cardverse:offers-updated"));
      await loadOffers();
    } catch (actionError) {
      toast({ variant: "destructive", title: copy.actionFailed, description: actionError instanceof Error ? actionError.message : copy.actionFailed });
    } finally {
      setActionOfferId(null);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, OfferItem[]>();
    for (const offer of items) {
      const group = map.get(offer.cardId) || [];
      group.push(offer);
      map.set(offer.cardId, group);
    }
    if (status === "pending" && view === "received") {
      for (const offers of map.values()) offers.sort((a, b) => b.price - a.price || b.createdAt.localeCompare(a.createdAt));
    }
    return Array.from(map.values());
  }, [items, status, view]);

  const renderOffer = (offer: OfferItem) => {
    const personName = offer.counterparty?.display_name || (view === "received" ? copy.buyer : copy.seller);
    const percentage = offer.card?.price ? Math.round((offer.price / offer.card.price) * 100) : null;
    return (
      <div key={offer.id} className="rounded-xl border border-white/10 bg-background/40 p-4 transition-colors hover:border-orange-500/25">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 border border-white/10">
            {offer.counterparty?.profile_image_url && <AvatarImage src={offer.counterparty.profile_image_url} alt="" />}
            <AvatarFallback>{initials(personName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="flex min-w-0 items-center gap-1 font-medium">
                  <span className="truncate">{personName}</span>
                  <VerifiedSellerBadge verified={offer.counterparty?.seller_verified} className="h-3.5 w-3.5" />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(offer.createdAt).toLocaleString(locale)}</p>
              </div>
              <Badge variant="outline" className={statusClass(offer.status)}>{statusText(offer.status)}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/20 p-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{copy.offered}</p>
                <p className="text-xl font-bold text-orange-400">{formatVND(offer.price)}</p>
              </div>
              {percentage !== null && <p className="text-sm font-semibold text-muted-foreground">{percentage}%</p>}
            </div>
            {!!offer.bundleSelection?.length && (
              <div className="mt-2 rounded-lg border border-white/5 bg-muted/10 p-3">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{copy.offeredCards}</p>
                <ul className="space-y-0.5 text-sm">
                  {offer.bundleSelection.map((bundleCard, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{bundleCard.title || `#${i + 1}`}</span>
                      <span className="shrink-0 text-muted-foreground">{formatVND(Number(bundleCard.price || 0))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {offer.message && <p className="mt-3 rounded-lg border border-white/5 bg-muted/10 p-3 text-sm leading-relaxed">{offer.message}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => void openChat(offer)} loading={openingChatId === offer.id} className="min-h-11 sm:min-h-9">
                {openingChatId === offer.id ? null : <MessageCircle className="mr-1.5 h-4 w-4" />}{copy.message}
              </Button>
              {view === "received" && offer.status === "pending" && (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ offer, action: "reject" })} disabled={Boolean(actionOfferId)} className="min-h-11 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 sm:min-h-9">
                    <X className="mr-1.5 h-4 w-4" />{copy.reject}
                  </Button>
                  <Button type="button" size="sm" onClick={() => setPendingAction({ offer, action: "accept" })} disabled={Boolean(actionOfferId)} className="col-span-2 min-h-11 bg-orange-500 text-white hover:bg-orange-600 sm:min-h-9">
                    <CheckCircle className="mr-1.5 h-4 w-4" />{copy.accept}
                  </Button>
                </>
              )}
              {view === "sent" && (offer.status === "chosen" || offer.status === "accepted") && (
                <Button type="button" size="sm" asChild className="min-h-11 bg-orange-500 text-white hover:bg-orange-600 sm:min-h-9">
                  <Link href={`/checkout?offerId=${offer.id}`}><CreditCard className="mr-1.5 h-4 w-4" />{copy.pay}</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (authLoading) return <div className="flex flex-1 flex-col bg-background"><main className="mx-auto max-w-6xl space-y-4 px-4 py-8"><Skeleton className="h-12 w-64" /><Skeleton className="h-80 w-full" /></main></div>;
  if (!user) return <div className="flex flex-1 flex-col bg-background"><main className="flex flex-1 items-center justify-center px-4"><Card className="max-w-md"><CardContent className="p-8 text-center"><HandCoins className="mx-auto mb-4 h-12 w-12 text-orange-400" /><p className="text-lg font-semibold">{copy.signIn}</p></CardContent></Card></main></div>;

  const statusFilters: Array<{ id: StatusFilter; label: string; count?: number }> = [
    { id: "all", label: copy.all }, { id: "pending", label: copy.pending, count: counts.pending },
    { id: "awaiting_payment", label: copy.awaiting, count: counts.awaitingPayment }, { id: "history", label: copy.history, count: counts.history },
  ];
  const selectedCard = focusedCard || items.find(item => item.cardId === cardId)?.card || null;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl"><HandCoins className="h-7 w-7 text-orange-400" />{copy.title}</h1><p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p></div>
          <Button type="button" variant="outline" size="icon" onClick={() => void loadOffers()} aria-label={copy.retry}><RefreshCw className="h-4 w-4" /></Button>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
          {[[copy.pendingKpi, counts.pending, "text-amber-400"], [copy.awaitingKpi, counts.awaitingPayment, "text-green-400"], [copy.historyKpi, counts.history, "text-muted-foreground"]].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl border bg-card p-3 sm:p-4"><p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p><p className={`mt-1 text-xl font-bold sm:text-2xl ${tone}`}>{value}</p></div>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-xl border bg-card p-1">
          {(["received", "sent"] as InboxView[]).map(tab => (
            <button key={tab} type="button" onClick={() => changeView(tab)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors ${view === tab ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>{tab === "received" ? copy.received : copy.sent}</button>
          ))}
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {statusFilters.map(filter => <button key={filter.id} type="button" onClick={() => setStatus(filter.id)} className={`min-h-10 min-w-0 rounded-xl border px-2 text-xs font-medium sm:w-auto sm:rounded-full sm:px-4 sm:text-sm ${status === filter.id ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-white/10 text-muted-foreground"}`}>{filter.label}{filter.count != null ? ` (${filter.count})` : ""}</button>)}
        </div>

        {cardId && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-orange-500/25 bg-orange-500/5 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">{selectedCard?.imageUrl ? <Image src={optimizeCloudinaryUrl(selectedCard.imageUrl, 160)} alt="" fill sizes="48px" className="object-cover" /> : <Package className="m-auto h-full w-5 text-muted-foreground" />}</div>
              <div className="min-w-0"><p className="truncate font-semibold">{selectedCard?.name || copy.viewCard}</p>{selectedCard?.price != null && <p className="text-sm text-orange-400">{copy.askingPrice}: {formatVND(selectedCard.price)}</p>}</div>
            </div>
            <Button variant="ghost" size="sm" asChild className="shrink-0"><Link href={`/offers?view=${view}`}><ArrowLeft className="mr-1.5 h-4 w-4" />{copy.backAll}</Link></Button>
          </div>
        )}

        {view === "received" && !canReceive ? <Card><CardContent className="p-8 text-center text-muted-foreground">{copy.notSeller}</CardContent></Card>
          : isLoading ? <div className="space-y-3">{[1, 2, 3].map(value => <Skeleton key={value} className="h-52 w-full rounded-xl" />)}</div>
            : error ? <Card><CardContent className="p-8 text-center"><p className="text-rose-400">{error}</p><Button className="mt-4" onClick={() => void loadOffers()}>{copy.retry}</Button></CardContent></Card>
              : grouped.length === 0 ? <Card><CardContent className="p-10 text-center"><HandCoins className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" /><p className="text-muted-foreground">{copy.empty}</p></CardContent></Card>
                : <div className={cardId ? "grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]" : "space-y-5"}>
                    {cardId && selectedCard && <Card className="hidden self-start lg:sticky lg:top-24 lg:block"><CardContent className="p-4"><div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">{selectedCard.imageUrl && <Image src={optimizeCloudinaryUrl(selectedCard.imageUrl, 500)} alt={selectedCard.name} fill sizes="280px" className="object-contain" />}</div><p className="mt-4 font-semibold">{selectedCard.name}</p>{selectedCard.price != null && <p className="mt-1 font-bold text-orange-400">{formatVND(selectedCard.price)}</p>}</CardContent></Card>}
                    <div className="space-y-5">{grouped.map(group => {
                      const card = group[0].card;
                      return <Card key={group[0].cardId}><CardHeader className="pb-3"><div className="flex items-center gap-3"><div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">{card?.imageUrl && <Image src={optimizeCloudinaryUrl(card.imageUrl, 160)} alt="" fill sizes="44px" className="object-cover" />}</div><div className="min-w-0 flex-1"><CardTitle className="truncate text-base sm:text-lg">{card?.name || copy.viewCard}</CardTitle><p className="text-sm text-muted-foreground">{card?.price != null ? `${copy.askingPrice}: ${formatVND(card.price)}` : ""}</p></div>{!cardId && <Button variant="ghost" size="sm" asChild><Link href={`/offers?view=${view}&cardId=${group[0].cardId}`}>{copy.viewCard}</Link></Button>}</div></CardHeader><CardContent className="space-y-3">{group.map(renderOffer)}</CardContent></Card>;
                    })}{nextCursor && <Button variant="outline" className="w-full" onClick={() => void loadOffers(nextCursor, true)} loading={isLoadingMore}>{isLoadingMore ? null : <Loader2 className="mr-2 hidden h-4 w-4" />}{copy.loadMore}</Button>}</div>
                  </div>}
      </main>

      <AlertDialog open={Boolean(pendingAction)} onOpenChange={open => { if (!open && !actionOfferId) setPendingAction(null); }}>
        <AlertDialogContent className="max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl">
          <AlertDialogHeader><AlertDialogTitle>{pendingAction?.action === "accept" ? copy.acceptTitle : copy.rejectTitle}</AlertDialogTitle><AlertDialogDescription>{pendingAction?.action === "accept" ? copy.acceptDesc : copy.rejectDesc}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={Boolean(actionOfferId)}>{copy.cancel}</AlertDialogCancel><Button onClick={runAction} loading={Boolean(actionOfferId)} className={pendingAction?.action === "reject" ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-orange-500 text-white hover:bg-orange-600"}>{pendingAction?.action === "accept" ? copy.accept : copy.reject}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function OffersPage() {
  return <Suspense fallback={<div className="flex flex-1 flex-col bg-background"><main className="mx-auto max-w-6xl px-4 py-8"><Skeleton className="h-96 w-full" /></main></div>}><OffersContent /></Suspense>;
}
