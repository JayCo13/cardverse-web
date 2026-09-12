'use client';

import { useState, type MouseEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, MapPin } from 'lucide-react';
import { AddressBook } from '@/components/address-book';
import { useAuthModal } from '@/components/auth-modal';
import { useBuyerShippingQuote } from '@/components/buyer-shipping-quotes';
import { useLocalization } from '@/context/localization-context';
import { isValidListingShippingFee } from '@/lib/shipping-fee';

/**
 * What a card costs to ship, wherever a card is shown before checkout.
 *
 * One of four honest answers: the seller's own flat price (free included), the
 * real GoShip price to the buyer's default address, an invitation to add an
 * address, or "cannot quote" naming why. Never a range and never a guess — the
 * number here is the number checkout starts from.
 *
 * The invitation opens the address book in place, so a buyer who came to browse
 * is not sent to a settings page to learn what a card costs to receive.
 */

type Props = {
    sellerId: string | null | undefined;
    /** The listing, so its own parcel preset prices it the way checkout will. */
    cardId?: string | null;
    /** cards.shipping_fee: 0 is free shipping, a number is the seller's flat price, null follows GoShip. */
    listingFee: number | null | undefined;
    /** Phone-sized: shortest possible label, no leading word. */
    compact?: boolean;
    /** Class for the price itself. */
    className?: string;
    /** Locale for number formatting; defaults to the app locale. */
    locale?: string;
};

export function ShippingQuoteLabel({ sellerId, cardId, listingFee, compact = false, className = '', locale: forcedLocale }: Props) {
    const { locale: appLocale } = useLocalization();
    const locale = forcedLocale ?? appLocale;
    const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);
    const money = (n: number) => `${new Intl.NumberFormat(locale).format(n)}đ`;
    const quote = useBuyerShippingQuote(isValidListingShippingFee(listingFee) ? null : sellerId, cardId);
    const { setOpen: setAuthOpen } = useAuthModal();
    const [bookOpen, setBookOpen] = useState(false);

    const stop = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };

    if (isValidListingShippingFee(listingFee)) {
        return listingFee === 0
            ? <span className={`font-medium text-green-400 ${className}`}>{tx('Miễn phí', 'Free', '送料無料')}</span>
            : <span className={`font-medium ${className}`}>{money(listingFee)}</span>;
    }

    if (quote.status === 'loading') {
        return <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground" aria-label={tx('Đang tính phí ship', 'Quoting shipping', '送料を計算中')} />;
    }

    if (quote.status === 'ready') {
        const from = quote.count > 1 ? tx('từ ', 'from ', '') : '';
        return <span className={`font-medium ${className}`}>{from}{money(quote.cheapest.fee)}</span>;
    }

    if (quote.status === 'error') {
        const label = quote.code === 'seller_does_not_ship_here'
            ? tx('Không giao tới bạn', 'Not to your area', 'お住まいの地域は配送不可')
            : quote.code === 'seller_shipping_origin_missing' || quote.code === 'seller_shipping_configuration_missing'
                ? tx('Người bán chưa thiết lập', 'Seller not set up', '販売者が未設定')
                : tx('Chưa tính được', 'Cannot quote now', '計算できません');
        return <span className={`text-muted-foreground ${className}`}>{label}</span>;
    }

    // signed_out / needs_address: an invitation, not a number.
    const invite = compact
        ? tx('Nhập địa chỉ', 'Add address', '住所を入力')
        : tx('Nhập địa chỉ để xem phí ship', 'Add an address to see shipping', '住所を入力して送料を表示');
    const open = (event: MouseEvent) => {
        stop(event);
        if (quote.status === 'signed_out') { setAuthOpen(true); return; }
        setBookOpen(true);
    };

    return (
        <>
            <button
                type="button"
                onClick={open}
                className={`inline-flex items-center gap-1 font-medium text-orange-400 underline-offset-2 hover:underline ${className}`}
            >
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                {invite}
            </button>
            {bookOpen && (
                <Dialog open onOpenChange={(next) => { if (!next) setBookOpen(false); }}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onClick={(event) => event.stopPropagation()}>
                        <DialogHeader>
                            <DialogTitle>{tx('Địa chỉ nhận hàng', 'Delivery address', 'お届け先')}</DialogTitle>
                            <DialogDescription>
                                {tx(
                                    'Phí ship là giá thật của đơn vị vận chuyển theo địa chỉ của bạn. Lưu một địa chỉ để xem.',
                                    'Shipping is the carrier’s real price for your address. Save one to see it.',
                                    '送料はお住まいの住所に対する配送業者の実料金です。住所を保存すると表示されます。',
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        <AddressBook />
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
