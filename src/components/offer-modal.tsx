'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { CheckCircle, HandCoins, History, Loader2, Lock, Tag } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';

export type BundleItem = { title?: string; price?: number };

export type OfferCard = {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  sellerId: string;
  minOfferPercent?: number | null;
  isBundle?: boolean | null;
  bundleItems?: BundleItem[] | null;
};

type OfferModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: OfferCard | null;
  onSuccess?: (conversationId?: string) => void;
};

type OfferHistoryItem = {
  id: string;
  price: number;
  message?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'chosen';
  createdAt: string;
  bundleSelection?: BundleItem[] | null;
};

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

export function OfferModal({ open, onOpenChange, card, onSuccess }: OfferModalProps) {
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const copy = locale === 'ja-JP'
    ? {
        sendOfferBody: '提案を送信',
        resendOfferBody: '再提案を送信',
        sentTitle: '提案を送信しました',
        reviewWithChat: '販売者が{price}を確認します。会話が作成されました。',
        reviewNoChat: '販売者があなたの{price}を確認します。',
        sendError: '提案を送信できませんでした。もう一度お試しください。',
        errorTitle: 'エラー',
        title: '価格交渉',
        desc: 'あなたの希望価格を送ってください。販売者が承認または拒否できます。',
        historyTitle: '提案履歴',
        historyDesc: '一度に送信できる提案は1件のみです。却下された場合、より高い価格で再提案できます。',
        pendingLock: '販売者の返答を待っています。返答前に新しい提案は送れません。',
        acceptedLock: 'この提案は承認済みです。決済へ進んでください。',
        rejectedHint: '前回の提案は却下されました。より高い金額で再提案できます。',
        listedPrice: '出品価格',
        bundleTotalLabel: 'まとめ売り {count}枚の合計',
        pickCards: '提案するカードを選択',
        selectedCount: '{n}/{total} 枚を選択',
        ofSelected: '選択分の価格',
        ofListed: '出品価格',
        offerPrice: '提案価格 (VND)',
        offerPlaceholder: '支払いたい金額を入力',
        minOfferHint: '販売者の最低提案額は {price}',
        higherThanRejected: '新しい提案は却下済みの {price} より高くする必要があります。',
        optionalMessage: 'メッセージ (任意)',
        messagePlaceholder: '例: この価格ならすぐ購入します',
        cancel: 'キャンセル',
        send: '提案を送信',
        resend: '再提案を送信',
        loadingHistory: '履歴を読み込み中',
        pending: '保留中',
        accepted: '承認済み',
        chosen: '決済待ち',
        rejected: '却下',
      }
    : locale === 'vi-VN'
      ? {
          sendOfferBody: 'Gửi đề nghị',
          resendOfferBody: 'Gửi lại đề nghị',
          sentTitle: 'Đã gửi đề nghị',
          reviewWithChat: 'Người bán sẽ xem xét mức giá {price}. Hội thoại đã được tạo.',
          reviewNoChat: 'Người bán sẽ xem xét mức giá {price} của bạn.',
          sendError: 'Không thể gửi đề nghị. Vui lòng thử lại.',
          errorTitle: 'Lỗi',
          title: 'Trả giá',
          desc: 'Đề xuất mức giá của bạn. Người bán có thể chấp nhận hoặc từ chối.',
          historyTitle: 'Lịch sử offer',
          historyDesc: 'Mỗi lần chỉ có thể gửi 1 đề nghị. Nếu người bán từ chối, bạn có thể đề xuất lại với giá cao hơn.',
          pendingLock: 'Offer đang chờ người bán phản hồi. Bạn chưa thể gửi offer mới.',
          acceptedLock: 'Offer này đã được chấp nhận. Vui lòng tiếp tục thanh toán.',
          rejectedHint: 'Offer trước đã bị từ chối. Bạn có thể gửi offer mới với mức giá cao hơn.',
          listedPrice: 'Giá niêm yết',
          bundleTotalLabel: 'Tổng {count} thẻ trong bài đăng',
          pickCards: 'Chọn thẻ muốn offer',
          selectedCount: 'Đã chọn {n}/{total}',
          ofSelected: 'giá các thẻ đã chọn',
          ofListed: 'giá niêm yết',
          offerPrice: 'Mức giá đề nghị (VND)',
          offerPlaceholder: 'Nhập số tiền bạn muốn trả',
          minOfferHint: 'Người bán chấp nhận đề nghị tối thiểu {price}',
          higherThanRejected: 'Offer mới phải cao hơn mức đã bị từ chối {price}.',
          optionalMessage: 'Lời nhắn (tùy chọn)',
          messagePlaceholder: 'Ví dụ: Mình lấy ngay nếu được giá này',
          cancel: 'Hủy',
          send: 'Gửi đề nghị',
          resend: 'Gửi lại đề nghị',
          loadingHistory: 'Đang tải lịch sử',
          pending: 'Đang chờ',
          accepted: 'Đã chấp nhận',
          chosen: 'Chờ thanh toán',
          rejected: 'Đã từ chối',
        }
      : {
          sendOfferBody: 'Send offer',
          resendOfferBody: 'Send another offer',
          sentTitle: 'Offer sent',
          reviewWithChat: 'The seller will review {price}. A conversation has been created.',
          reviewNoChat: 'The seller will review your {price} offer.',
          sendError: 'Could not send the offer. Please try again.',
          errorTitle: 'Error',
          title: 'Make an offer',
          desc: 'Suggest your price. The seller can accept or decline it.',
          historyTitle: 'Offer history',
          historyDesc: 'Only one offer can be active at a time. If the seller declines, you may submit a higher offer.',
          pendingLock: 'Your offer is waiting for the seller. You cannot send another offer yet.',
          acceptedLock: 'This offer was accepted. Please continue to checkout.',
          rejectedHint: 'Your previous offer was rejected. You can send a higher offer.',
          listedPrice: 'Listed price',
          bundleTotalLabel: 'Total of {count} cards in this listing',
          pickCards: 'Pick the cards to offer on',
          selectedCount: '{n}/{total} selected',
          ofSelected: 'of the selected cards',
          ofListed: 'of the listed price',
          offerPrice: 'Offer price (VND)',
          offerPlaceholder: 'Enter the amount you want to pay',
          minOfferHint: 'Seller minimum accepted offer is {price}',
          higherThanRejected: 'Your next offer must be higher than the rejected {price}.',
          optionalMessage: 'Message (optional)',
          messagePlaceholder: 'Example: I will buy immediately at this price',
          cancel: 'Cancel',
          send: 'Send offer',
          resend: 'Send another offer',
          loadingHistory: 'Loading history',
          pending: 'Pending',
          accepted: 'Accepted',
          chosen: 'Awaiting payment',
          rejected: 'Rejected',
        };

  const [offerPrice, setOfferPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [offerHistory, setOfferHistory] = useState<OfferHistoryItem[]>([]);
  const [canOfferAgain, setCanOfferAgain] = useState(true);
  const [minimumNextOffer, setMinimumNextOffer] = useState<number | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<number[]>([]);

  const bundleItems: BundleItem[] = (card?.isBundle && Array.isArray(card.bundleItems))
    ? card.bundleItems
    : [];
  const isBundle = bundleItems.length > 0;

  // The listing's own `price` column is not what a bundle costs: /api/marketplace/buy
  // charges the sum of the cards actually taken and ignores it entirely. Offering
  // against it showed buyers a number nobody would ever be asked to pay.
  const bundleTotal = bundleItems.reduce((sum, item) => sum + (item.price || 0), 0);
  const selectedTotal = selectedBundle.reduce((sum, i) => sum + (bundleItems[i]?.price || 0), 0);
  /** What the offer is measured against — the picked cards, or the whole listing. */
  const referencePrice = isBundle ? selectedTotal : card?.price || 0;
  const listedPrice = isBundle ? bundleTotal : card?.price || 0;

  const minOffer = card && card.minOfferPercent && referencePrice > 0
    ? Math.ceil((referencePrice * card.minOfferPercent) / 100)
    : 0;

  const loadOfferHistory = async () => {
    if (!card || !user) return;
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/offers?cardId=${encodeURIComponent(card.id)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.sendError);
      setOfferHistory(payload.offers || []);
      setCanOfferAgain(Boolean(payload.canOfferAgain));
      setMinimumNextOffer(payload.minimumNextOffer || null);
    } catch (error) {
      const description = error instanceof Error ? error.message : copy.sendError;
      toast({ variant: 'destructive', title: copy.errorTitle, description });
      setOfferHistory([]);
      setCanOfferAgain(true);
      setMinimumNextOffer(null);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (!open || !card || !user) {
      setOfferPrice('');
      setMessage('');
      setOfferHistory([]);
      setCanOfferAgain(true);
      setMinimumNextOffer(null);
      setSelectedBundle([]);
      return;
    }
    // Everything selected by default: offering on the whole bundle is the
    // common case, and unticking is less work than ticking.
    setSelectedBundle(bundleItems.map((_, i) => i));

    void loadOfferHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id, user?.id]);

  const parsedPrice = parseInt(offerPrice.replace(/[^\d]/g, ''), 10) || 0;
  const latestOffer = offerHistory[0] || null;
  const latestRejectedOffer = offerHistory.find(offer => offer.status === 'rejected') || null;
  const hasHistory = offerHistory.length > 0;
  const lockedByPending = latestOffer?.status === 'pending';
  const lockedByAccepted = latestOffer?.status === 'accepted' || latestOffer?.status === 'chosen';
  const showOfferForm = !hasHistory || (canOfferAgain && latestOffer?.status === 'rejected');
  const belowMin = minOffer > 0 && parsedPrice > 0 && parsedPrice < minOffer;
  const belowRejected = !!latestRejectedOffer && parsedPrice > 0 && parsedPrice <= latestRejectedOffer.price;
  const canSubmit = showOfferForm && parsedPrice > 0 && !belowMin && !belowRejected && !isSubmitting
    && (!isBundle || selectedBundle.length > 0);

  const statusLabel = (status: OfferHistoryItem['status']) => {
    if (status === 'pending') return copy.pending;
    if (status === 'accepted') return copy.accepted;
    if (status === 'chosen') return copy.chosen;
    return copy.rejected;
  };

  const statusClass = (status: OfferHistoryItem['status']) => {
    if (status === 'rejected') return 'bg-red-500/15 text-red-300';
    if (status === 'pending') return 'bg-amber-500/15 text-amber-300';
    return 'bg-emerald-500/15 text-emerald-300';
  };

  const handleSubmit = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card || !canSubmit) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: card.id,
          price: parsedPrice,
          message: message.trim() || null,
          bundleSelection: isBundle
            ? selectedBundle.map(i => ({ title: bundleItems[i]?.title || '', price: bundleItems[i]?.price || 0 }))
            : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.sendError);

      const conversationId = payload.conversationId as string | undefined;
      toast({
        title: copy.sentTitle,
        description: conversationId
          ? copy.reviewWithChat.replace('{price}', formatVND(parsedPrice))
          : copy.reviewNoChat.replace('{price}', formatVND(parsedPrice)),
      });
      window.dispatchEvent(new Event('cardverse:chat-updated'));
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (err: unknown) {
      const description = err instanceof Error ? err.message : copy.sendError;
      toast({ variant: 'destructive', title: copy.errorTitle, description });
      await loadOfferHistory();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-md">
        <DialogHeader className="shrink-0 border-b border-white/10 px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2">
            {hasHistory ? (
              <History className="h-5 w-5 text-amber-500" />
            ) : (
              <HandCoins className="h-5 w-5 text-amber-500" />
            )}
            {hasHistory ? copy.historyTitle : copy.title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 sm:text-sm">{hasHistory ? copy.historyDesc : copy.desc}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:space-y-4 sm:px-6 sm:py-4">
          <div className="flex gap-3 rounded-lg bg-accent/50 p-2.5 sm:p-3">
            {card.imageUrl && (
              <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded sm:h-20 sm:w-14">
                <Image src={card.imageUrl} alt="" fill sizes="(max-width: 639px) 48px, 56px" className="rounded object-contain" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold">{card.name}</p>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                {isBundle ? copy.bundleTotalLabel.replace('{count}', String(bundleItems.length)) : copy.listedPrice}
              </div>
              <p className="text-base font-bold text-primary sm:text-lg">{formatVND(listedPrice)}</p>
            </div>
          </div>

          {isBundle && showOfferForm && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{copy.pickCards}</Label>
              <div className="max-h-32 space-y-1 overflow-y-auto overscroll-contain rounded-lg border p-1.5 sm:max-h-40 sm:p-2">
                {bundleItems.map((item, i) => (
                  <label
                    key={i}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${selectedBundle.includes(i) ? 'bg-amber-500/10' : 'hover:bg-accent/50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedBundle.includes(i)}
                      onChange={() => setSelectedBundle(prev => (
                        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                      ))}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.title || `#${i + 1}`}</span>
                    <span className="shrink-0 text-sm font-semibold text-amber-500">{formatVND(item.price || 0)}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {copy.selectedCount.replace('{n}', String(selectedBundle.length)).replace('{total}', String(bundleItems.length))}
                </span>
                <span className="font-bold text-amber-500">{formatVND(selectedTotal)}</span>
              </div>
            </div>
          )}

          {isLoadingHistory ? (
            <div className="flex items-center justify-center rounded-lg border p-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {copy.loadingHistory}
            </div>
          ) : hasHistory && (
            <div className="max-h-32 space-y-1.5 overflow-y-auto overscroll-contain rounded-lg border p-2 sm:max-h-40 sm:p-3">
              {offerHistory.map(offer => (
                <div key={offer.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/40 px-2 py-1.5 sm:py-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{formatVND(offer.price)}</p>
                    {!!offer.bundleSelection?.length && (
                      <p className="truncate text-xs text-muted-foreground">
                        {offer.bundleSelection.map(item => item.title).filter(Boolean).join(', ')}
                      </p>
                    )}
                    {offer.message && <p className="text-xs text-muted-foreground">{offer.message}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass(offer.status)}`}>
                    {statusLabel(offer.status)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lockedByPending && (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-200 sm:p-3 sm:text-sm">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              {copy.pendingLock}
            </div>
          )}

          {lockedByAccepted && (
            <div className="flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs leading-5 text-emerald-200 sm:p-3 sm:text-sm">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {copy.acceptedLock}
            </div>
          )}

          {showOfferForm && (
            <>
              {latestRejectedOffer && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs leading-5 text-red-200 sm:p-3 sm:text-sm">
                  {copy.rejectedHint}
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{copy.offerPrice}</Label>
                <Input
                  inputMode="numeric"
                  value={offerPrice ? new Intl.NumberFormat('vi-VN').format(parsedPrice) : ''}
                  onChange={e => setOfferPrice(e.target.value)}
                  placeholder={copy.offerPlaceholder}
                  className="h-10"
                />
                {minOffer > 0 && (
                  <p className={`text-xs ${belowMin ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {copy.minOfferHint.replace('{price}', formatVND(minOffer))}
                    {card.minOfferPercent
                      ? ` (${card.minOfferPercent}% ${isBundle ? copy.ofSelected : copy.ofListed})`
                      : ''}.
                  </p>
                )}
                {minimumNextOffer && (
                  <p className={`text-xs ${belowRejected ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {copy.higherThanRejected.replace('{price}', formatVND(minimumNextOffer - 1))}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{copy.optionalMessage}</Label>
                <Input
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={copy.messagePlaceholder}
                  className="h-10"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className={`shrink-0 border-t border-white/10 bg-background/95 p-3 backdrop-blur sm:px-6 sm:py-4 ${showOfferForm ? 'grid grid-cols-2 gap-2 sm:flex sm:flex-row' : 'flex'}`}>
          <Button variant="outline" className={showOfferForm ? '' : 'w-full sm:w-auto'} onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          {showOfferForm && (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-amber-500 font-bold text-white hover:bg-amber-600"
            >
              {isSubmitting ? null : <CheckCircle className="mr-2 h-4 w-4" />}
              {latestRejectedOffer ? copy.resend : copy.send}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
