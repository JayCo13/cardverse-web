
'use client';

import { useState, useMemo, useEffect } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { CardItem } from '@/components/card-item';
import type { Card, CardCategory, CardCondition } from '@/lib/types';
import { useLocalization } from '@/context/localization-context';
import { FilterSidebar } from '@/components/filter-sidebar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ListFilter } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import dynamic from 'next/dynamic';

// Checkout (and its heavy GHN address picker) is only needed after the user
// clicks "Buy", so keep it out of the initial /buy bundle.
const CheckoutModal = dynamic(
  () => import('@/components/checkout-modal').then((m) => m.CheckoutModal),
  { ssr: false }
);

// Make-offer flow is only needed once a buyer taps "Trả giá".
const OfferModal = dynamic(
  () => import('@/components/offer-modal').then((m) => m.OfferModal),
  { ssr: false }
);

export type Filters = {
  search: string;
  categories: CardCategory[];
  conditions: CardCondition[];
  minPrice?: string;
  maxPrice?: string;
  publishers?: string[];
  sets?: string[];
  acceptsOffers?: boolean;
  verifiedSellers?: boolean;
  bundlesOnly?: boolean;
  gradedOnly?: boolean;
};

type SortOption = 'newest' | 'price-asc' | 'price-desc';

export default function BuyPage() {
  const { t, locale } = useLocalization();
  const [filters, setFilters] = useState<Filters>({
    search: '',
    categories: [],
    conditions: [],
    minPrice: '',
    maxPrice: '',
    publishers: [],
    sets: [],
    acceptsOffers: false,
    verifiedSellers: false,
    bundlesOnly: false,
    gradedOnly: false,
  });
  const [sort, setSort] = useState<SortOption>('price-desc');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const supabase = useSupabase();
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const [saleCards, setSaleCards] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutCard, setCheckoutCard] = useState<Card | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [sellerAddress, setSellerAddress] = useState<{ districtId: number; wardCode: string } | null>(null);
  const [offerCard, setOfferCard] = useState<Card | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);

  useEffect(() => {
    const fetchCards = async () => {
      // Self-heal: release cards whose QR/PayOS reservation lapsed so abandoned
      // checkouts don't keep them hidden from the marketplace.
      await supabase.rpc('release_expired_card_reservations' as never);

      const { data, error } = await supabase
        .from('cards')
        .select('*, profiles:seller_id(display_name, profile_image_url, seller_verified, seller_rating, seller_review_count)')
        .eq('listing_type', 'sale')
        .eq('status', 'active');

      if (data && !error) {
        let cards: Card[] = (data as any[]).map((c: any) => ({
          id: c.id,
          name: c.name,
          imageUrl: c.image_url || '',
          imageUrls: c.image_urls,
          category: c.category,
          condition: c.condition,
          listingType: c.listing_type,
          price: c.price,
          currentBid: c.current_bid,
          startingBid: c.starting_bid,
          auctionEnds: c.auction_ends,
          ticketPrice: c.ticket_price,
          razzEntries: c.razz_entries,
          totalTickets: c.total_tickets,
          sellerId: c.seller_id,
          author: c.profiles?.display_name || 'Unknown Seller',
          sellerName: c.profiles?.display_name || 'Unknown Seller',
          sellerAvatar: c.profiles?.profile_image_url || null,
          sellerVerified: c.profiles?.seller_verified || false,
          sellerRating: c.profiles?.seller_rating ?? null,
          sellerReviewCount: c.profiles?.seller_review_count ?? 0,
          description: c.description,
          lastSoldPrice: c.last_sold_price,
          status: c.status,
          publisher: c.publisher,
          setName: c.set_name,
          season: c.season,
          quantity: c.quantity,
          isBundle: c.is_bundle,
          bundleItems: c.bundle_items,
          acceptOffers: c.accept_offers,
          minOfferPercent: c.min_offer_percent,
          cardNumber: c.card_number,
          language: c.language,
          gradingCompany: c.grading_company,
          grade: c.grade,
          createdAt: c.created_at,
          priceIsVnd: true, // Marketplace listings are entered in VND
        }));
        if (user && cards.length > 0) {
          const cardIds = cards.map(card => card.id);
          const { data: offers } = await supabase
            .from('offers')
            .select('card_id, status, created_at')
            .eq('buyer_id', user.id)
            .in('card_id', cardIds)
            .order('created_at', { ascending: false });

          const latestOfferByCard = new Map<string, 'pending' | 'accepted' | 'rejected' | 'chosen'>();
          (offers || []).forEach((offer: any) => {
            if (!latestOfferByCard.has(offer.card_id)) {
              latestOfferByCard.set(offer.card_id, offer.status);
            }
          });

          cards = cards.map(card => ({
            ...card,
            buyerOfferStatus: latestOfferByCard.get(card.id) || null,
          }));
        }
        setSaleCards(cards);
      }
      setIsLoading(false);
    };
    fetchCards();
  }, [supabase, user]);

  const filteredAndSortedCards = useMemo(() => {
    if (!saleCards) return [];

    let filtered = saleCards.filter((card) => {
      const {
        search,
        categories,
        conditions,
        minPrice,
        maxPrice,
        publishers = [],
        sets = [],
        acceptsOffers,
        verifiedSellers,
        bundlesOnly,
        gradedOnly,
      } = filters;

      const searchTerm = search.trim().toLocaleLowerCase(locale);
      const searchableText = [
        card.name,
        card.cardNumber,
        card.publisher,
        card.setName,
        card.season,
        card.sellerName,
      ].filter(Boolean).join(' ').toLocaleLowerCase(locale);

      if (searchTerm && !searchableText.includes(searchTerm)) {
        return false;
      }
      if (categories.length && !categories.includes(card.category as CardCategory)) {
        return false;
      }
      if (conditions.length && !conditions.includes(card.condition as CardCondition)) {
        return false;
      }
      const price = card.price ?? 0;
      const min = Number(minPrice || 0);
      const max = Number(maxPrice || 0);
      if (min > 0 && price < min) return false;
      if (max > 0 && price > max) return false;
      if (publishers.length && (!card.publisher || !publishers.includes(card.publisher))) return false;
      if (sets.length && (!card.setName || !sets.includes(card.setName))) return false;
      if (acceptsOffers && !card.acceptOffers) return false;
      if (verifiedSellers && !card.sellerVerified) return false;
      if (bundlesOnly && !card.isBundle) return false;
      if (gradedOnly && (!card.gradingCompany || card.gradingCompany === 'raw')) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sort) {
        case 'newest':
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case 'price-asc':
          return (a.price ?? 0) - (b.price ?? 0);
        case 'price-desc':
          return (b.price ?? 0) - (a.price ?? 0);
        default:
          return 0;
      }
    });
  }, [filters, locale, sort, saleCards]);

  const renderCardList = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg">
              <Skeleton className="w-full md:w-1/5 aspect-square md:aspect-[3/4] rounded-lg" />
              <div className="flex-1 flex flex-col md:flex-row p-4">
                <div className="flex-grow md:w-3/5 space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-6 w-1/4" />
                </div>
                <div className="md:w-2/5 flex flex-col justify-center items-end mt-4 md:mt-0 space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (filteredAndSortedCards.length > 0) {
      return (
        <div className="flex flex-col gap-4">
          {filteredAndSortedCards.map((card) => (
            <CardItem key={card.id} card={card} layout="list" onAddToCart={async (c) => {
              if (!user) {
                setAuthOpen(true);
                return;
              }
              try {
                const response = await fetch('/api/cart', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ card_id: c.id }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Không thể thêm vào giỏ hàng');
                toast({ title: 'Thêm vào giỏ hàng thành công' });
                window.dispatchEvent(new Event('cardverse:cart-updated'));
              } catch (error: any) {
                toast({ variant: 'destructive', title: 'Lỗi giỏ hàng', description: error.message });
              }
            }} onBuyClick={async (c) => {
              setCheckoutCard({
                ...c,
                id: c.id,
                name: c.name,
                imageUrl: c.imageUrl,
                price: c.price ?? 0,
                category: c.category,
                condition: c.condition,
                sellerId: c.sellerId,
              } as any);

              // Fetch seller address for shipping fee calculation
              try {
                const { data: sellerProfile } = await supabase
                  .from('profiles')
                  .select('address_district_id, address_ward_code')
                  .eq('id', c.sellerId)
                  .single();

                if (sellerProfile?.address_district_id && sellerProfile?.address_ward_code) {
                  setSellerAddress({
                    districtId: sellerProfile.address_district_id,
                    wardCode: sellerProfile.address_ward_code,
                  });
                } else {
                  setSellerAddress(null);
                }
              } catch {
                setSellerAddress(null);
              }

              setCheckoutOpen(true);
            }}
            onOfferClick={(c) => {
              setOfferCard(c);
              setOfferOpen(true);
            }} />
          ))}
        </div>
      );
    }

    return (
      <div className="text-center py-16">
        <p className="text-xl font-semibold">{t('no_cards_match')}</p>
        <p className="text-muted-foreground">{t('try_adjusting_filters')}</p>
      </div>
    );
  };


  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('buy_title')}</h1>
          <p className="text-muted-foreground">{t('buy_description')}</p>
        </div>
        <div className="flex gap-8">
          <div className="hidden md:block w-1/4">
            <FilterSidebar filters={filters} onFiltersChange={setFilters} showListingTypeFilter={false} showAdvancedFilters availableCards={saleCards} />
          </div>
          <div className="w-full md:w-3/4">
            <div className="flex justify-between items-center mb-6">
              <p className="text-sm text-muted-foreground">
                {t('showing_cards_for_sale').replace('{count}', filteredAndSortedCards.length.toString()).replace('{total}', (saleCards || []).length.toString())}
              </p>
              <div className='flex items-center gap-4'>
                <div className="md:hidden">
                  <Sheet open={isSidebarOpen} onOpenChange={setSidebarOpen}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="icon">
                        <ListFilter className="h-4 w-4" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-3/4">
                      <FilterSidebar filters={filters} onFiltersChange={setFilters} showListingTypeFilter={false} showAdvancedFilters availableCards={saleCards} />
                    </SheetContent>
                  </Sheet>
                </div>
                <Select value={sort} onValueChange={(value) => setSort(value as SortOption)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('sort_by_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{locale === 'vi-VN' ? 'Mới đăng' : locale === 'ja-JP' ? '新着順' : 'Newest'}</SelectItem>
                    <SelectItem value="price-desc">{t('sort_price_desc')}</SelectItem>
                    <SelectItem value="price-asc">{t('sort_price_asc')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {renderCardList()}
          </div>
        </div>
      </main>
      <Footer />
      {checkoutCard && (
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        card={checkoutCard ? {
          id: checkoutCard.id,
          name: checkoutCard.name,
          image_url: checkoutCard.imageUrl,
          price: checkoutCard.price ?? 0,
          category: checkoutCard.category,
          condition: checkoutCard.condition || '',
          seller_id: checkoutCard.sellerId,
        } : null}
        sellerAddress={sellerAddress}
        onSuccess={() => {
          window.location.reload();
        }}
      />
      )}
      {offerCard && (
        <OfferModal
          open={offerOpen}
          onOpenChange={setOfferOpen}
          card={{
            id: offerCard.id,
            name: offerCard.name,
            imageUrl: offerCard.imageUrl,
            price: offerCard.price ?? 0,
            sellerId: offerCard.sellerId,
            minOfferPercent: offerCard.minOfferPercent ?? 0,
          }}
          onSuccess={(conversationId) => {
            setSaleCards(cards => cards.map(card => (
              card.id === offerCard.id ? { ...card, buyerOfferStatus: 'pending' } : card
            )));
            if (conversationId) {
              window.dispatchEvent(new CustomEvent('cardverse:open-chat', { detail: { conversationId } }));
            }
          }}
        />
      )}
    </div>
  );
}
