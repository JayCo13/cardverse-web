'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MagnifyingGlass, SpinnerGap } from '@phosphor-icons/react';
import { Package } from 'lucide-react';
import Image from 'next/image';

/** Product data from tcgcsv_products */
interface CatalogProduct {
  product_id: number;
  name: string;
  image_url: string | null;
  set_name: string | null;
  rarity: string | null;
  market_price: number | null;
  category_id: number;
}

/** What gets returned when a card is selected */
export interface SelectedCatalogCard {
  name: string;
  category: string;
  publisher: string;
  setName: string;
  imageUrl: string;
}

const TABS = [
  { id: 'pokemon', label: 'Pokémon', categoryIds: [3, 85], publisher: 'The Pokémon Company', categoryValue: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece', categoryIds: [68], publisher: 'Bandai', categoryValue: 'One Piece' },
  // Soccer doesn't have tcgcsv_products data, so not included
];

interface CardPickerDialogProps {
  onSelect: (card: SelectedCatalogCard) => void;
}

export function CardPickerDialog({ onSelect }: CardPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('pokemon');
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCards = useCallback(async (tab: string, query: string) => {
    const tabConfig = TABS.find(t => t.id === tab);
    if (!tabConfig) return;

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      let dbQuery = supabase
        .from('tcgcsv_products')
        .select('product_id, name, image_url, set_name, rarity, market_price, category_id')
        .in('category_id', tabConfig.categoryIds)
        .not('image_url', 'is', null)
        .not('market_price', 'is', null)
        .gt('market_price', 0);

      if (query.trim()) {
        dbQuery = dbQuery.ilike('name', `%${query.trim()}%`);
      }

      const { data, error } = await dbQuery
        .order('market_price', { ascending: false })
        .limit(30);

      if (error) throw error;
      setCards(data || []);
    } catch (err) {
      console.error('Failed to fetch catalog cards:', err);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when dialog opens or tab/search changes
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => fetchCards(activeTab, search), 300);
    return () => clearTimeout(timer);
  }, [open, activeTab, search, fetchCards]);

  const handleSelect = (card: CatalogProduct) => {
    const tabConfig = TABS.find(t => t.categoryIds.includes(card.category_id));
    if (!tabConfig) return;

    onSelect({
      name: card.name,
      category: tabConfig.categoryValue,
      publisher: tabConfig.publisher,
      setName: card.set_name || '',
      imageUrl: card.image_url || '',
    });
    setOpen(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="gap-2 border-dashed border-primary/40 hover:border-primary text-primary">
          <Package className="h-4 w-4" />
          Chọn thẻ từ bộ sưu tập
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">Chọn thẻ từ cơ sở dữ liệu</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setSearch(''); }}>
          <TabsList className="grid grid-cols-2 w-full max-w-[300px]">
            {TABS.map(tab => (
              <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* Search */}
          <div className="relative mt-4">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={`Tìm kiếm thẻ ${TABS.find(t => t.id === activeTab)?.label || ''}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="mt-4 overflow-y-auto max-h-[50vh] pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <SpinnerGap className="w-6 h-6 animate-spin text-primary" weight="bold" />
                <span className="ml-2 text-muted-foreground">Đang tải...</span>
              </div>
            ) : cards.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {cards.map(card => (
                  <button
                    key={card.product_id}
                    type="button"
                    onClick={() => handleSelect(card)}
                    className="group relative rounded-lg border border-border/50 bg-card overflow-hidden text-left hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {/* Image */}
                    <div className="relative aspect-[3/4] bg-muted/30">
                      {card.image_url ? (
                        <Image
                          src={card.image_url}
                          alt={card.name}
                          fill
                          className="object-contain p-1 group-hover:scale-105 transition-transform"
                          sizes="(max-width: 768px) 50vw, 25vw"
                          unoptimized
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          <Package className="h-8 w-8" />
                        </div>
                      )}
                      {/* Price badge */}
                      {card.market_price && (
                        <span className="absolute top-1.5 right-1.5 bg-black/70 text-green-400 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          ${card.market_price.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-2">
                      <p className="text-xs font-medium line-clamp-2 leading-tight">{card.name}</p>
                      {card.set_name && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{card.set_name}</p>
                      )}
                    </div>
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Không tìm thấy thẻ nào</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Thử tìm kiếm với từ khóa khác</p>
              </div>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
