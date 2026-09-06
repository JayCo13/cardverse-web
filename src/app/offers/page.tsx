"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi as viLocale } from "date-fns/locale";
import {
  ArrowDownUp, ArrowLeft, CheckCircle, ChevronLeft, ChevronRight, CreditCard,
  HandCoins, Loader2, MessageCircle, Package, RefreshCw, X,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useSupabase } from "@/lib/supabase";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { UserLink } from "@/components/user-link";
import { VerifiedSellerBadge } from "@/components/verified-seller-badge";

type InboxView = "received" | "sent";
type StatusFilter = "all" | "pending" | "awaiting_payment" | "history";
type SortOrder = "newest" | "price_desc" | "price_asc";

const CARD_PAGE_SIZE = 5;
const OFFER_PAGE_SIZE = 10;
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
  orderId: string | null;
  card: {
    id: string; name: string; imageUrl: string | null; price: number | null; status: string;
    isBundle: boolean; bundleItems: Record<string, unknown>[] | null;
  } | null;
  counterparty: { id: string; display_name: string | null; profile_image_url: string | null; seller_verified: boolean | null } | null;
  bundleSelection: { title?: string; price?: number }[] | null;
};

type InboxResponse = {
  items: OfferItem[];
  counts: { pending: number; awaitingPayment: number; history: number };
  nextCursor: string | null;
  groupCounts: Record<string, number>;
  selectedCard: OfferItem["card"];
};

type PendingAction = { offer: OfferItem; action: "accept" | "reject" } | null;
type LoadMode = "initial" | "page" | "background";

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
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>("newest");
  /**
   * The API pages by keyset, not by offset, so there is no page 7 to jump to —
   * each page is reachable only from the one before it. Keeping the cursor that
   * opened each page turns that into Prev/Next without pretending otherwise.
   * Index 0 is the first page and has no cursor.
   */
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [focusedCard, setFocusedCard] = useState<OfferItem["card"]>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionOfferId, setActionOfferId] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const actionKeys = useRef<Record<string, string>>({});
  const currentCursorRef = useRef<string | undefined>(undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);

  const copy = locale === "vi-VN" ? {
    title: "Offer", subtitle: "Theo dõi offer đã gửi và xử lý offer bạn nhận được.",
    received: "Đã nhận", sent: "Đã gửi", pending: "Đang chờ", awaiting: "Chờ thanh toán", history: "Lịch sử", all: "Tất cả",
    pendingKpi: "Chờ phản hồi", awaitingKpi: "Chờ thanh toán", historyKpi: "Đã xử lý",
    empty: "Chưa có offer trong mục này.", loadFailed: "Không thể tải danh sách offer.", retry: "Thử lại", loadMore: "Xem thêm",
    buyer: "Người mua", seller: "Người bán", askingPrice: "Giá niêm yết", offered: "Giá đề nghị", offeredCards: "Thẻ được offer", viewCard: "Xem thẻ", viewOffers: "Xem tất cả {count} offer", offerCount: "{count} offer",
    message: "Nhắn tin", accept: "Chấp nhận", reject: "Từ chối", pay: "Thanh toán ngay",
    viewOrder: "Xem đơn hàng", cardTaken: "Thẻ đã có người khác mua",
    sortNewest: "Mới nhất", sortPriceDesc: "Giá cao nhất", sortPriceAsc: "Giá thấp nhất", sortLabel: "Sắp xếp",
    page: "Trang {n}", prev: "Trước", next: "Sau",
    pendingStatus: "Đang chờ phản hồi", chosenStatus: "Đã chấp nhận, chờ thanh toán", acceptedStatus: "Đã mua",
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
    buyer: "購入者", seller: "販売者", askingPrice: "販売価格", offered: "提示価格", offeredCards: "対象カード", viewCard: "カードを見る", viewOffers: "全{count}件を見る", offerCount: "{count}件のオファー",
    message: "メッセージ", accept: "承認", reject: "拒否", pay: "今すぐ支払う",
    viewOrder: "注文を見る", cardTaken: "このカードは他の方が購入しました",
    sortNewest: "新着順", sortPriceDesc: "高い順", sortPriceAsc: "安い順", sortLabel: "並べ替え",
    page: "{n} ページ", prev: "前へ", next: "次へ",
    pendingStatus: "返答待ち", chosenStatus: "承認済み・支払い待ち", acceptedStatus: "購入済み",
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
    buyer: "Buyer", seller: "Seller", askingPrice: "Asking price", offered: "Offer", offeredCards: "Cards offered on", viewCard: "View card", viewOffers: "View all {count} offers", offerCount: "{count} offers",
    message: "Message", accept: "Accept", reject: "Reject", pay: "Pay now",
    viewOrder: "View order", cardTaken: "Another buyer bought this card",
    sortNewest: "Newest", sortPriceDesc: "Highest price", sortPriceAsc: "Lowest price", sortLabel: "Sort",
    page: "Page {n}", prev: "Prev", next: "Next",
    pendingStatus: "Waiting for response", chosenStatus: "Accepted, awaiting payment", acceptedStatus: "Purchased",
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

  const loadOffers = useCallback(async (cursor?: string, mode: LoadMode = "initial") => {
    if (!user) return;
    const requestSequence = ++requestSequenceRef.current;
    if (mode === "page") setIsLoadingMore(true);
    else if (mode === "initial") { setIsLoading(true); setError(null); }
    try {
      const params = new URLSearchParams({ view, status, sort, limit: String(cardId ? OFFER_PAGE_SIZE : CARD_PAGE_SIZE) });
      if (cardId) params.set("cardId", cardId);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/offers/inbox?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as InboxResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || copy.loadFailed);
      if (requestSequence !== requestSequenceRef.current) return;
      setItems(payload.items);
      setCounts(payload.counts);
      setGroupCounts(payload.groupCounts || {});
      setNextCursor(payload.nextCursor);
      setFocusedCard(payload.selectedCard || null);
    } catch (loadError) {
      if (requestSequence !== requestSequenceRef.current) return;
      if (mode !== "background") {
        setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [cardId, copy.loadFailed, sort, status, user, view]);

  /**
   * Changing what is being listed invalidates every cursor already collected —
   * a cursor only means anything against the query that produced it.
   */
  useEffect(() => {
    currentCursorRef.current = undefined;
    setPageCursors([undefined]);
    setPageIndex(0);
  }, [view, status, sort, cardId]);

  useEffect(() => { void loadOffers(); }, [loadOffers]);

  const goToPage = (next: number, cursor?: string) => {
    currentCursorRef.current = cursor;
    setPageIndex(next);
    void loadOffers(cursor, "page");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goNext = () => {
    if (!nextCursor) return;
    setPageCursors(current => {
      const copyList = current.slice(0, pageIndex + 1);
      copyList.push(nextCursor);
      return copyList;
    });
    goToPage(pageIndex + 1, nextCursor);
  };
  const goPrev = () => {
    if (pageIndex === 0) return;
    goToPage(pageIndex - 1, pageCursors[pageIndex - 1]);
  };

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadOffers(currentCursorRef.current, "background");
      }, 300);
    };
    window.addEventListener("focus", refresh);
    const channel = supabase.channel(`offer-inbox-${user.id}-${view}`);
    if (view === "sent") {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "offers", filter: `buyer_id=eq.${user.id}` }, refresh);
    } else {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "offers" }, refresh);
    }
    channel.subscribe();
    return () => {
      window.removeEventListener("focus", refresh);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [loadOffers, supabase, user, view]);

  const changeView = (next: InboxView) => {
    setView(next);
    setStatus(next === "received" ? "pending" : "all");
    router.replace(`/offers?view=${next}`);
  };

  const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

  const dateLocale = locale === "vi-VN" ? viLocale : locale === "ja-JP" ? ja : enUS;
  /** "2 ngày trước" instead of "17:10:13 5/9/2026" — a third of the width. */
  const relativeTime = (iso: string) => {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateLocale });
    } catch {
      return new Date(iso).toLocaleDateString(locale);
    }
  };

  const sortOptions: Array<{ id: SortOrder; label: string }> = [
    { id: "newest", label: copy.sortNewest },
    { id: "price_desc", label: copy.sortPriceDesc },
    { id: "price_asc", label: copy.sortPriceAsc },
  ];

  const statusText = (offerStatus: OfferStatus) => ({
    pending: copy.pendingStatus,
    chosen: copy.chosenStatus,
    accepted: copy.acceptedStatus,
    rejected: copy.rejectedStatus,
    expired: copy.expiredStatus,
  })[offerStatus];

  /**
   * The card behind a still-unpaid offer is no longer buyable.
   *
   * The scheduled sweep closes these within ten minutes, but until it runs the
   * row still says `chosen`, and paying would fail. `card.status` has been in
   * this response all along and was never read.
   *
   * A `chosen` offer's own card sits at `in_transaction` — that reservation is
   * this buyer's — so only `sold` (or a card that has vanished) counts as lost.
   *
   * A partial bundle offer reserves nothing, so it needs the second test: its
   * named items can be bought from under it while the listing stays `active`
   * with the rest. `/api/checkout` re-matches the selection against the current
   * `bundle_items` and 409s, so without this the button is a dead end.
   */
  const cardIsGone = (offer: OfferItem) => {
    if (!offer.card) return true;
    if (offer.card.status === "sold") return true;
    const selection = offer.bundleSelection;
    if (!selection || selection.length === 0) return false;
    // Same rule as `bundle_selection_available` in SQL: match by value AND
    // occurrence, so two identical cards in a bundle stay two distinct units.
    // Both arrays come back from the same jsonb column, so their keys are in
    // the same normalised order and stringifying is a safe identity.
    const remaining = new Map<string, number>();
    for (const item of offer.card.bundleItems ?? []) {
      const key = JSON.stringify(item);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    for (const item of selection) {
      const key = JSON.stringify(item);
      const left = remaining.get(key) ?? 0;
      if (left === 0) return true;
      remaining.set(key, left - 1);
    }
    return false;
  };

  // `accepted` is a settled purchase, not an open one, so it wears the muted
  // colour of the other finished states. Only `chosen` still wants something
  // from the buyer.
  const statusClass = (offerStatus: OfferStatus) => offerStatus === "pending"
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : offerStatus === "chosen"
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
      await loadOffers(currentCursorRef.current, "background");
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
    // No client-side re-sort: the server already ordered the page by `sort`,
    // and re-sorting here would silently override whatever the user picked.
    return Array.from(map.values());
  }, [items]);

  const renderOffer = (offer: OfferItem) => {
    const personName = offer.counterparty?.display_name || (view === "received" ? copy.buyer : copy.seller);
    const percentage = offer.card?.price ? Math.round((offer.price / offer.card.price) * 100) : null;
    return (
      /* One offer is one row, not a stack of boxes. The price is the thing
         being compared, so it stays large; everything else — who, when, how
         far off the ask — collapses onto the line beside it. Fifteen offers on
         a phone used to be fifteen screens. */
      <div key={offer.id} className="rounded-lg border border-white/10 bg-background/40 px-3 py-2.5 transition-colors hover:border-orange-500/25">
        <div className="flex items-start gap-2.5">
          <UserLink variant="plain" userId={offer.counterparty?.id} className="shrink-0">
            <Avatar className="h-8 w-8 border border-white/10">
              {offer.counterparty?.profile_image_url && <AvatarImage src={offer.counterparty.profile_image_url} alt="" />}
              <AvatarFallback className="text-[11px]">{initials(personName)}</AvatarFallback>
            </Avatar>
          </UserLink>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <UserLink userId={offer.counterparty?.id} className="truncate text-sm font-medium">{personName}</UserLink>
              <VerifiedSellerBadge verified={offer.counterparty?.seller_verified} className="h-3.5 w-3.5" />
              <Badge variant="outline" className={`ml-auto shrink-0 px-1.5 py-0 text-[10px] ${statusClass(offer.status)}`}>{statusText(offer.status)}</Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-lg font-bold tabular-nums text-orange-400">{formatVND(offer.price)}</span>
              {percentage !== null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{percentage}%</span>}
              <span className="text-xs text-muted-foreground">· {relativeTime(offer.createdAt)}</span>
            </div>
            {!!offer.bundleSelection?.length && (
              /* Chips, not a table: a partial bundle offer usually names one or
                 two cards, and a boxed list for two lines wasted a third of the
                 row's height. */
              <div className="mt-1.5 flex flex-wrap gap-1">
                {offer.bundleSelection.map((bundleCard, i) => (
                  <span key={i} className="inline-flex max-w-full items-center gap-1 rounded border border-white/10 bg-muted/20 px-1.5 py-0.5 text-[11px]">
                    <span className="truncate">{bundleCard.title || `#${i + 1}`}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatVND(Number(bundleCard.price || 0))}</span>
                  </span>
                ))}
              </div>
            )}
            {offer.message && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-white/10 pl-2 text-xs leading-snug text-muted-foreground" title={offer.message}>
                {offer.message}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => void openChat(offer)} loading={openingChatId === offer.id} className="h-9">
                {openingChatId === offer.id ? null : <MessageCircle className="mr-1.5 h-4 w-4" />}{copy.message}
              </Button>
              {view === "received" && offer.status === "pending" && (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPendingAction({ offer, action: "reject" })} disabled={Boolean(actionOfferId)} className="h-9 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 sm:min-h-9">
                    <X className="mr-1.5 h-4 w-4" />{copy.reject}
                  </Button>
                  <Button type="button" size="sm" onClick={() => setPendingAction({ offer, action: "accept" })} disabled={Boolean(actionOfferId)} className="h-9 bg-orange-500 text-white hover:bg-orange-600 sm:min-h-9">
                    <CheckCircle className="mr-1.5 h-4 w-4" />{copy.accept}
                  </Button>
                </>
              )}
              {/* Only `chosen` is unpaid. `accepted` means the payment finalisers
                  already ran, so it gets a way back to the order instead. And
                  even a `chosen` offer is unpayable once its card is gone —
                  checkout would 409 — so say so here rather than send the buyer
                  into a dead end. */}
              {view === "sent" && offer.status === "chosen" && (
                cardIsGone(offer) ? (
                  <p className="self-center text-xs text-muted-foreground">{copy.cardTaken}</p>
                ) : (
                  <Button type="button" size="sm" asChild className="h-9 bg-orange-500 text-white hover:bg-orange-600">
                    <Link href={`/checkout?offerId=${offer.id}`}><CreditCard className="mr-1.5 h-4 w-4" />{copy.pay}</Link>
                  </Button>
                )
              )}
              {view === "sent" && offer.status === "accepted" && offer.orderId && (
                <Button type="button" variant="outline" size="sm" asChild className="h-9">
                  <Link href={`/orders/${offer.orderId}`}><Package className="mr-1.5 h-4 w-4" />{copy.viewOrder}</Link>
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

        {/* Filter picks the set, sort picks the order. Side by side on desktop;
            stacked cleanly on mobile with a polished dropdown button. */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
            {statusFilters.map(filter => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                className={`min-h-10 min-w-0 rounded-xl border px-3 text-xs font-medium transition-all sm:w-auto sm:rounded-full sm:px-4 sm:text-sm ${
                  status === filter.id
                    ? "border-orange-500 bg-orange-500/15 text-orange-300 font-semibold shadow-sm"
                    : "border-white/10 bg-card/40 text-muted-foreground hover:border-white/20 hover:text-foreground"
                }`}
              >
                {filter.label}{filter.count != null ? ` (${filter.count})` : ""}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-auto sm:shrink-0">
            <Select value={sort} onValueChange={value => setSort(value as SortOrder)}>
              <SelectTrigger
                aria-label={copy.sortLabel}
                className="h-10 w-full rounded-xl border-white/10 bg-card/80 px-3.5 text-xs font-medium text-foreground shadow-sm transition-all hover:border-orange-500/30 hover:bg-card focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 sm:w-auto sm:min-w-[190px]"
              >
                <div className="flex items-center gap-2 truncate pr-1">
                  <ArrowDownUp className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  <span className="text-muted-foreground shrink-0">{copy.sortLabel}:</span>
                  <span className="font-semibold text-foreground truncate">
                    <SelectValue placeholder={sortOptions.find(o => o.id === sort)?.label || copy.sortNewest} />
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent
                align="end"
                className="min-w-[190px] rounded-xl border-white/10 bg-card/95 p-1 shadow-2xl backdrop-blur-xl"
              >
                {sortOptions.map(option => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    className="cursor-pointer rounded-lg py-2 pl-8 pr-3 text-xs font-medium transition-colors focus:bg-orange-500/10 focus:text-orange-400 data-[state=checked]:font-semibold data-[state=checked]:text-orange-400"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                    <div className="space-y-4">
                      {grouped.map(group => {
                        const card = group[0].card;
                        const groupCardId = group[0].cardId;
                        const offerCount = groupCounts[groupCardId] || group.length;
                        return (
                          <Card key={groupCardId}>
                            <CardHeader className="pb-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                                  {card?.imageUrl && <Image src={optimizeCloudinaryUrl(card.imageUrl, 160)} alt="" fill sizes="36px" className="object-cover" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <CardTitle className="truncate text-sm sm:text-base">{card?.name || copy.viewCard}</CardTitle>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {card?.price != null ? `${copy.askingPrice}: ${formatVND(card.price)}` : ""}
                                    {` · ${fill(copy.offerCount, { count: offerCount })}`}
                                  </p>
                                </div>
                                {!cardId && (
                                  <Button variant="ghost" size="sm" asChild className="h-8 shrink-0 px-2 text-xs">
                                    <Link href={`/offers?view=${view}&cardId=${groupCardId}`}>{fill(copy.viewOffers, { count: offerCount })}</Link>
                                  </Button>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-2 pb-3">
                              {group.map(renderOffer)}
                            </CardContent>
                          </Card>
                        );
                      })}

                      {(pageIndex > 0 || nextCursor) && (
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <Button type="button" variant="outline" size="sm" className="h-10 min-w-24" onClick={goPrev}
                            disabled={pageIndex === 0 || isLoadingMore}>
                            <ChevronLeft className="mr-1 h-4 w-4" />{copy.prev}
                          </Button>
                          <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                            {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {fill(copy.page, { n: pageIndex + 1 })}
                          </span>
                          <Button type="button" variant="outline" size="sm" className="h-10 min-w-24" onClick={goNext}
                            disabled={!nextCursor || isLoadingMore}>
                            {copy.next}<ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
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
