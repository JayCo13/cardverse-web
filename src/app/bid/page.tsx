
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

export type Filters = {
  search: string;
  categories: CardCategory[];
  conditions: CardCondition[];
};

type SortOption = 'price-asc' | 'price-desc' | 'ending-soon';

export default function BidPage() {
  const { t, locale } = useLocalization();
  const [filters, setFilters] = useState<Filters>({
    search: '',
    categories: [],
    conditions: [],
  });
  const [sort, setSort] = useState<SortOption>('ending-soon');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const supabase = useSupabase();
  const [auctionCards, setAuctionCards] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCards = async () => {
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .eq('listing_type', 'auction')
        .eq('status', 'active');

      if (data && !error) {
        const cards: Card[] = data.map(c => ({
          id: c.id, name: c.name, imageUrl: c.image_url || '', imageUrls: c.image_urls,
          category: c.category, condition: c.condition, listingType: c.listing_type,
          price: c.price, currentBid: c.current_bid, startingBid: c.starting_bid,
          auctionEnds: c.auction_ends, ticketPrice: c.ticket_price, razzEntries: c.razz_entries,
          totalTickets: c.total_tickets, sellerId: c.seller_id, author: c.seller_id,
          description: c.description, status: c.status,
        }));
        setAuctionCards(cards);
      }
      setIsLoading(false);
    };
    fetchCards();
  }, []); // supabase is stable singleton

  const filteredAndSortedCards = useMemo(() => {
    if (!auctionCards) return [];

    let filtered = auctionCards.filter((card) => {
      const { search, categories, conditions } = filters;

      const name = card.name.toLowerCase();
      const searchTerm = search.toLowerCase();

      if (search && !name.includes(searchTerm)) {
        return false;
      }
      if (categories.length && !categories.includes(card.category as CardCategory)) {
        return false;
      }
      if (conditions.length && !conditions.includes(card.condition as CardCondition)) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sort) {
        case 'price-asc':
          return (a.currentBid ?? 0) - (b.currentBid ?? 0);
        case 'price-desc':
          return (b.currentBid ?? 0) - (a.currentBid ?? 0);
        case 'ending-soon':
          return new Date(a.auctionEnds!).getTime() - new Date(b.auctionEnds!).getTime();
        default:
          return 0;
      }
    });
  }, [filters, sort, auctionCards]);

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
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-9 w-full mt-2" />
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
            <CardItem key={card.id} card={card} layout="list" />
          ))}
        </div>
      );
    }

    return (
      <div className="text-center py-16">
        <p className="text-xl font-semibold">{t('no_auctions_match')}</p>
        <p className="text-muted-foreground">{t('try_adjusting_filters_or_check_back')}</p>
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('bid_title')}</h1>
          <p className="text-muted-foreground">{t('bid_description')}</p>
        </div>
        <div className="flex gap-8">
          <div className="hidden md:block w-1/4">
            <FilterSidebar filters={filters} onFiltersChange={setFilters} showListingTypeFilter={false} />
          </div>
          <div className="w-full md:w-3/4">
            <div className="flex justify-between items-center mb-6">
              <p className="text-sm text-muted-foreground">
                {t('showing_auctions').replace('{count}', filteredAndSortedCards.length.toString()).replace('{total}', (auctionCards || []).length.toString())}
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
                      <FilterSidebar filters={filters} onFiltersChange={(newFilters) => {
                        setFilters(newFilters);
                        setSidebarOpen(false);
                      }} showListingTypeFilter={false} />
                    </SheetContent>
                  </Sheet>
                </div>
                <Select value={sort} onValueChange={(value) => setSort(value as SortOption)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('sort_by_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ending-soon">{t('so_ending_soon')}</SelectItem>
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
    </div>
  );
}
