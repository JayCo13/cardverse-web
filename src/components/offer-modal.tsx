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
                body: `${existingOffer ? 'Cập nhật đề nghị' : 'Gửi đề nghị'} ${formatVND(parsedPrice)} cho "${card.name}"${message.trim() ? `: ${message.trim()}` : '.'}`,
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
          title: 'Đề xuất giá mới',
          message: `Có người đề xuất ${formatVND(parsedPrice)} cho thẻ "${card.name}"`,
          card_id: card.id,
          offer_id: offerId,
          conversation_id: conversationId || null,
          read: false,
        } as never);
      }

      toast({
        title: existingOffer ? '✅ Đã cập nhật đề nghị' : '🤝 Đã gửi đề nghị',
        description: conversationId
          ? `Người bán sẽ xem xét mức giá ${formatVND(parsedPrice)}. Hội thoại đã được tạo.`
          : `Người bán sẽ xem xét mức giá ${formatVND(parsedPrice)} của bạn.`,
      });
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (err: unknown) {
      const description = err instanceof Error ? err.message : 'Không thể gửi đề nghị. Vui lòng thử lại.';
      toast({ variant: 'destructive', title: 'Lỗi', description });
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
            Trả giá
          </DialogTitle>
          <DialogDescription>Đề xuất mức giá của bạn. Người bán có thể chấp nhận hoặc từ chối.</DialogDescription>
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
                Giá niêm yết
              </div>
              <p className="text-lg font-bold text-primary">{formatVND(card.price)}</p>
            </div>
          </div>

          {/* Offer input */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Mức giá đề nghị (VND)</Label>
            <Input
              inputMode="numeric"
              value={offerPrice ? new Intl.NumberFormat('vi-VN').format(parsedPrice) : ''}
              onChange={e => setOfferPrice(e.target.value)}
              placeholder="Nhập số tiền bạn muốn trả"
              className="h-10"
            />
            {minOffer > 0 && (
              <p className={`text-xs ${belowMin ? 'text-red-400' : 'text-muted-foreground'}`}>
                Người bán chấp nhận đề nghị tối thiểu {formatVND(minOffer)}
                {card.minOfferPercent ? ` (${card.minOfferPercent}% giá niêm yết)` : ''}.
              </p>
            )}
          </div>

          {/* Optional message */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Lời nhắn (tùy chọn)</Label>
            <Input
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Ví dụ: Mình lấy ngay nếu được giá này"
              className="h-10"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
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
            {existingOffer ? 'Cập nhật đề nghị' : 'Gửi đề nghị'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
