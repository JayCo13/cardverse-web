
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
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Listings per page.
 *
 * Paginated on the client, not in the query: the filters and the sort both run
 * over the whole result set, so asking the database for a range would page
 * through unfiltered rows and show the wrong ones. Rendering is what costs on a
 * phone — every card mounts an image, a price and three buttons — so capping
 * what is mounted is where the saving is.
 */
const PAGE_SIZE = 15;
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
  const [sort, setSort] = useState<SortOption>('newest');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState(1);
  const supabase = useSupabase();
  const { user } = useAuth();
  const { setOpen: setAuthOpen } = useAuthModal();
  const { toast } = useToast();
  const [saleCards, setSaleCards] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutCard, setCheckoutCard] = useState<Card | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPreselected, setCheckoutPreselected] = useState<number[]>([]);
  // Pre-checkout dialog for bundles: buyer picks which cards to buy first.
  const [bundlePickCard, setBundlePickCard] = useState<Card | null>(null);
  const [bundlePickOpen, setBundlePickOpen] = useState(false);
  const [bundlePickSelected, setBundlePickSelected] = useState<number[]>([]);

  const proceedToCheckout = async (c: Card, preselected: number[]) => {
    setCheckoutCard({
      ...c,
      id: c.id,
      name: c.name,
      imageUrl: c.imageUrl,
      image_url: c.imageUrl,
      price: c.price ?? 0,
      category: c.category,
      condition: c.condition,
      sellerId: c.sellerId,
      isBundle: c.isBundle,
      bundleItems: c.bundleItems,
    } as any);
    setCheckoutPreselected(preselected);

    // Fetch seller address for shipping fee calculation
    try {
      const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('address_district_id, address_ward_code')
        .eq('id', c.sellerId)
        .single();
      const sp = sellerProfile as any;
      if (sp?.address_district_id && sp?.address_ward_code) {
        setSellerAddress({ districtId: sp.address_district_id, wardCode: sp.address_ward_code });
      } else {
        setSellerAddress(null);
      }
    } catch {
      setSellerAddress(null);
    }

    setCheckoutOpen(true);
  };
  const [sellerAddress, setSellerAddress] = useState<{ districtId: number; wardCode: string } | null>(null);
  const [offerCard, setOfferCard] = useState<Card | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);

  useEffect(() => {
    // The listing query, factored out so a release can re-run it.
    const queryCards = () => supabase
      .from('cards')
      .select('*, profiles:seller_id(display_name, profile_image_url, seller_verified, seller_rating, seller_review_count, shipping_carriers, shipping_fees)')
      .eq('listing_type', 'sale')
      .eq('status', 'active');

    const fetchCards = async () => {
      // These three used to run one after another, and each round trip to the
      // database costs 150-400ms from a browser — so the marketplace waited
      // roughly a second before drawing anything. Nothing here depends on the
      // others: the housekeeping call self-heals lapsed reservations, and a
      // buyer's own offers can be fetched by buyer alone and matched to cards in
      // memory rather than by feeding card ids into a second query.
      const [releaseResult, cardsResult, offersResult] = await Promise.all([
        supabase.rpc('release_expired_card_reservations' as never),
        queryCards(),
        user
          ? supabase
            .from('offers')
            .select('card_id, status, created_at')
            .eq('buyer_id', user.id)
            .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] as { card_id: string; status: string; created_at: string }[] }),
      ]);

      // Running the release concurrently means this render can miss a card it
      // just freed. Rare, and cheap to correct: re-read only when it actually
      // released something.
      const released = Number(releaseResult.data ?? 0);
      const { data, error } = released > 0 ? await queryCards() : cardsResult;

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
          shippingCarriers: c.profiles?.shipping_carriers || [],
          shippingFees: (c.profiles?.shipping_fees || {}) as Record<string, { intra?: number; inter?: number; region?: number }>,
        }));
        if (user && cards.length > 0) {
          const offers = offersResult.data;

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

  const pageCount = Math.max(1, Math.ceil(filteredAndSortedCards.length / PAGE_SIZE));
  // Clamped rather than trusted: narrowing a filter can shrink the result set
  // below the page the reader is standing on, which would otherwise render an
  // empty list under a "12 results" heading.
  const currentPage = Math.min(page, pageCount);

  const visibleCards = useMemo(
    () => filteredAndSortedCards.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredAndSortedCards, currentPage],
  );

  // Any change to what is being listed sends the reader back to the first page.
  useEffect(() => { setPage(1); }, [filters, sort]);

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), pageCount));
    // On a phone the list is taller than the screen, so paging without this
    // leaves the reader in the middle of a page they have not seen the top of.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderCardList = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-2 md:gap-4">
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
        <div className="flex flex-col gap-2 md:gap-4">
          {visibleCards.map((card) => (
            <CardItem key={card.id} card={card} layout="list" showGhnReadiness={false} onAddToCart={async (c) => {
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
                if (!response.ok) throw new Error(payload.error || t('cart_add_failed'));
                toast({ title: t('cart_add_success') });
                window.dispatchEvent(new Event('cardverse:cart-updated'));
              } catch (error: any) {
                toast({ variant: 'destructive', title: t('cart_error_title'), description: error.message });
              }
            }} onBuyClick={async (c) => {
              // Bundle → let the buyer pick which cards first, then checkout.
              const items = c.isBundle ? c.bundleItems || [] : [];
              if (items.length > 0) {
                setBundlePickCard(c);
                setBundlePickSelected(items.map((_, i) => i));
                setBundlePickOpen(true);
                return;
              }
              await proceedToCheckout(c, []);
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

  /**
   * Page control.
   *
   * Numbers are windowed to five so the row never wraps on a phone, and the
   * window slides to keep the current page inside it. Below `sm` only the arrows
   * and a "3 / 12" counter remain, which is all that fits at 360px.
   */
  const renderPagination = () => {
    if (pageCount <= 1) return null;

    const windowSize = 5;
    const start = Math.max(1, Math.min(currentPage - Math.floor(windowSize / 2), pageCount - windowSize + 1));
    const pages = Array.from(
      { length: Math.min(windowSize, pageCount) },
      (_, index) => start + index,
    );

    const prevLabel = locale === 'vi-VN' ? 'Trước' : locale === 'ja-JP' ? '前へ' : 'Prev';
    const nextLabel = locale === 'vi-VN' ? 'Sau' : locale === 'ja-JP' ? '次へ' : 'Next';

    return (
      <nav className="flex items-center justify-center gap-1.5 mt-8" aria-label={prevLabel}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label={prevLabel}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline ml-1">{prevLabel}</span>
        </Button>

        <div className="hidden sm:flex items-center gap-1.5">
          {pages.map((pageNumber) => (
            <Button
              key={pageNumber}
              variant={pageNumber === currentPage ? 'default' : 'outline'}
              size="sm"
              className="w-9 tabular-nums"
              onClick={() => goToPage(pageNumber)}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
            >
              {pageNumber}
            </Button>
          ))}
        </div>

        <span className="sm:hidden px-3 text-sm text-muted-foreground tabular-nums">
          {currentPage} / {pageCount}
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === pageCount}
          aria-label={nextLabel}
        >
          <span className="hidden sm:inline mr-1">{nextLabel}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </nav>
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
                {t('showing_cards_for_sale')
                  .replace('{count}', filteredAndSortedCards.length.toString())
                  .replace('{total}', (saleCards || []).length.toString())}
                {pageCount > 1 && (
                  <span className="ml-1 tabular-nums">
                    · {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredAndSortedCards.length)}
                  </span>
                )}
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
            {!isLoading && renderPagination()}
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
          isBundle: checkoutCard.isBundle,
          bundleItems: checkoutCard.bundleItems as any,
        } : null}
        preselectedBundle={checkoutPreselected}
        sellerAddress={sellerAddress}
        onSuccess={() => {
          window.location.reload();
        }}
      />
      )}

      {/* Bundle: pick which cards to buy before secure checkout */}
      <Dialog open={bundlePickOpen} onOpenChange={setBundlePickOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chọn thẻ muốn mua</DialogTitle>
            <DialogDescription>
              Bài đăng này gồm nhiều thẻ. Chọn (các) thẻ bạn muốn mua rồi bấm Tiếp tục.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const items = (bundlePickCard?.bundleItems || []) as { title?: string; price?: number }[];
            const total = bundlePickSelected.reduce((s, i) => s + (items[i]?.price || 0), 0);
            const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
            const toggle = (i: number) =>
              setBundlePickSelected(prev => (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]));
            return (
              <>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {items.map((it, i) => (
                    <label
                      key={i}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors ${bundlePickSelected.includes(i) ? 'bg-orange-500/10' : 'hover:bg-accent/50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={bundlePickSelected.includes(i)}
                        onChange={() => toggle(i)}
                        className="h-4 w-4 accent-orange-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{it.title || `Thẻ ${i + 1}`}</span>
                      <span className="shrink-0 text-sm font-semibold text-orange-500">{fmt(it.price || 0)}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Đã chọn {bundlePickSelected.length}/{items.length}</span>
                  <span className="font-bold text-orange-500">{fmt(total)}</span>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBundlePickOpen(false)}>Huỷ</Button>
                  <Button
                    className="bg-orange-500 hover:bg-orange-600"
                    disabled={bundlePickSelected.length === 0 || !bundlePickCard}
                    onClick={async () => {
                      if (!bundlePickCard) return;
                      setBundlePickOpen(false);
                      await proceedToCheckout(bundlePickCard, [...bundlePickSelected].sort((a, b) => a - b));
                    }}
                  >
                    Tiếp tục
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
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
