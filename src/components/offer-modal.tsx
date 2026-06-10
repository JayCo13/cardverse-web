'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag, HandCoins, Loader2, CheckCircle } from 'lucide-react';
import { useAuth, useSupabase } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import Image from 'next/image';

export type OfferCard = {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  sellerId: string;
  minOfferPercent?: number | null;
};

type OfferModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: OfferCard | null;
  onSuccess?: (conversationId?: string) => void;
};

type ExistingOffer = { id: string; price: number };

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

export function OfferModal({ open, onOpenChange, card, onSuccess }: OfferModalProps) {
  const { user } = useAuth();
  const supabase = useSupabase();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const { locale } = useLocalization();
  const copy = locale === 'ja-JP'
    ? {
        updateOfferBody: '提案を更新',
        sendOfferBody: '提案を送信',
        sellerOfferTitle: '新しい価格提案',
        sellerOfferMessage: 'このカードに{price}の提案が届きました: "{name}"',
        updatedTitle: '提案を更新しました',
        sentTitle: '提案を送信しました',
        reviewWithChat: '販売者が{price}を確認します。会話が作成されました。',
        reviewNoChat: '販売者があなたの{price}を確認します。',
        sendError: '提案を送信できませんでした。もう一度お試しください。',
        title: '価格交渉',
        desc: 'あなたの希望価格を送ってください。販売者が承認または拒否できます。',
        listedPrice: '出品価格',
        offerPrice: '提案価格 (VND)',
        offerPlaceholder: '支払いたい金額を入力',
        minOfferHint: '販売者の最低提案額は {price}',
        optionalMessage: 'メッセージ (任意)',
        messagePlaceholder: '例: この価格ならすぐ購入します',
        cancel: 'キャンセル',
        update: '提案を更新',
        send: '提案を送信',
      }
    : locale === 'vi-VN'
      ? {
          updateOfferBody: 'Cập nhật đề nghị',
          sendOfferBody: 'Gửi đề nghị',
          sellerOfferTitle: 'Đề xuất giá mới',
          sellerOfferMessage: 'Có người đề xuất {price} cho thẻ "{name}"',
          updatedTitle: 'Đã cập nhật đề nghị',
          sentTitle: 'Đã gửi đề nghị',
          reviewWithChat: 'Người bán sẽ xem xét mức giá {price}. Hội thoại đã được tạo.',
          reviewNoChat: 'Người bán sẽ xem xét mức giá {price} của bạn.',
          sendError: 'Không thể gửi đề nghị. Vui lòng thử lại.',
          title: 'Trả giá',
          desc: 'Đề xuất mức giá của bạn. Người bán có thể chấp nhận hoặc từ chối.',
          listedPrice: 'Giá niêm yết',
          offerPrice: 'Mức giá đề nghị (VND)',
          offerPlaceholder: 'Nhập số tiền bạn muốn trả',
          minOfferHint: 'Người bán chấp nhận đề nghị tối thiểu {price}',
          optionalMessage: 'Lời nhắn (tùy chọn)',
          messagePlaceholder: 'Ví dụ: Mình lấy ngay nếu được giá này',
          cancel: 'Hủy',
          update: 'Cập nhật đề nghị',
          send: 'Gửi đề nghị',
        }
      : {
          updateOfferBody: 'Update offer',
          sendOfferBody: 'Send offer',
          sellerOfferTitle: 'New offer received',
          sellerOfferMessage: 'Someone offered {price} for "{name}"',
          updatedTitle: 'Offer updated',
          sentTitle: 'Offer sent',
          reviewWithChat: 'The seller will review {price}. A conversation has been created.',
          reviewNoChat: 'The seller will review your {price} offer.',
          sendError: 'Could not send the offer. Please try again.',
          title: 'Make an offer',
          desc: 'Suggest your price. The seller can accept or decline it.',
          listedPrice: 'Listed price',
          offerPrice: 'Offer price (VND)',
          offerPlaceholder: 'Enter the amount you want to pay',
          minOfferHint: 'Seller minimum accepted offer is {price}',
          optionalMessage: 'Message (optional)',
          messagePlaceholder: 'Example: I will buy immediately at this price',
          cancel: 'Cancel',
          update: 'Update offer',
          send: 'Send offer',
        };

  const [offerPrice, setOfferPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingOffer, setExistingOffer] = useState<ExistingOffer | null>(null);

  // Seller's floor: minOfferPercent of the listed price (0 = no floor).
  const minOffer = card && card.minOfferPercent
    ? Math.ceil((card.price * card.minOfferPercent) / 100)
    : 0;

  // Reset and load any existing pending offer when the modal opens.
  useEffect(() => {
    if (!open || !card || !user) {
      setOfferPrice('');
      setMessage('');
      setExistingOffer(null);
      return;
    }

    const loadExisting = async () => {
      const { data } = await supabase
        .from('offers')
        .select('id, price')
        .eq('card_id', card.id)
        .eq('buyer_id', user.id)
        .eq('status', 'pending')
        .maybeSingle<ExistingOffer>();

      if (data) {
        setExistingOffer(data);
        setOfferPrice(String(data.price));
      }
    };
    void loadExisting();
  }, [open, card, user, supabase]);

  const parsedPrice = parseInt(offerPrice.replace(/[^\d]/g, ''), 10) || 0;
  const belowMin = minOffer > 0 && parsedPrice > 0 && parsedPrice < minOffer;
  const canSubmit = parsedPrice > 0 && !belowMin && !isSubmitting;

  const handleSubmit = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!card || !canSubmit) return;

    setIsSubmitting(true);
    try {
      let offerId = existingOffer?.id || null;
      if (existingOffer) {
        // Update the buyer's existing pending offer.
        const { error } = await supabase
          .from('offers')
          .update({ price: parsedPrice, message: message.trim() || null } as never)
          .eq('id', existingOffer.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('offers').insert({
          card_id: card.id,
          buyer_id: user.id,
          price: parsedPrice,
          message: message.trim() || null,
          status: 'pending',
        } as never).select('id').single();
        if (error) throw error;
        offerId = (data as { id: string } | null)?.id || null;
      }

      let conversationId: string | undefined;
      if (offerId) {
        try {
          const conversationResponse = await fetch('/api/chat/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cardId: card.id, offerId }),
          });
          const conversationPayload = await conversationResponse.json();
          if (conversationResponse.ok && conversationPayload.conversation?.id) {
            conversationId = conversationPayload.conversation.id;
            await fetch('/api/chat/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conversationId,
                messageType: 'offer_auto',
                body: `${existingOffer ? copy.updateOfferBody : copy.sendOfferBody} ${formatVND(parsedPrice)} ${card.name}${message.trim() ? `: ${message.trim()}` : '.'}`,
                metadata: {
                  offerId,
                  cardId: card.id,
                  price: parsedPrice,
                },
              }),
            });
          }
        } catch (chatError) {
          console.error('Could not create offer conversation:', chatError);
        }
      }

      if (!existingOffer) {
        // Notify the seller about the new offer, linking the conversation so a
        // notification click can open the right chat thread.
        await supabase.from('notifications').insert({
          user_id: card.sellerId,
          type: 'offer_received',
          title: copy.sellerOfferTitle,
          message: copy.sellerOfferMessage.replace('{price}', formatVND(parsedPrice)).replace('{name}', card.name),
          card_id: card.id,
          offer_id: offerId,
          conversation_id: conversationId || null,
          read: false,
        } as never);
      }

      toast({
        title: existingOffer ? copy.updatedTitle : copy.sentTitle,
        description: conversationId
          ? copy.reviewWithChat.replace('{price}', formatVND(parsedPrice))
          : copy.reviewNoChat.replace('{price}', formatVND(parsedPrice)),
      });
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (err: unknown) {
      const description = err instanceof Error ? err.message : copy.sendError;
      toast({ variant: 'destructive', title: 'Error', description });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-500" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Card summary */}
          <div className="flex gap-3 p-3 rounded-lg bg-accent/50">
            {card.imageUrl && (
              <div className="relative w-14 h-20 rounded overflow-hidden flex-shrink-0">
                <Image src={card.imageUrl} alt="" width={56} height={80} className="object-cover rounded" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold line-clamp-2 text-sm">{card.name}</p>
              <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                <Tag className="h-3.5 w-3.5" />
                {copy.listedPrice}
              </div>
              <p className="text-lg font-bold text-primary">{formatVND(card.price)}</p>
            </div>
          </div>

          {/* Offer input */}
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
                {card.minOfferPercent ? ` (${card.minOfferPercent}% giá niêm yết)` : ''}.
              </p>
            )}
          </div>

          {/* Optional message */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{copy.optionalMessage}</Label>
            <Input
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={copy.messagePlaceholder}
              className="h-10"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            {existingOffer ? copy.update : copy.send}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
