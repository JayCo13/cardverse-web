'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/supabase';
import { MagnifyingGlass, SpinnerGap } from '@phosphor-icons/react';
import { Package, Library } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocalization } from '@/context/localization-context';

/** Card data from user_collections */
interface CollectionCard {
  id: string;
  user_id: string;
  title: string;
  price: string | null;
  image_url: string | null;
  category: string | null;
  market_price: number | null;
  rarity: string | null;
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
  { id: 'all', label: 'Tất cả', categoryFilter: null },
  { id: 'pokemon', label: 'Pokémon', categoryFilter: 'Pokemon' },
  { id: 'onepiece', label: 'One Piece', categoryFilter: 'One Piece' },
  { id: 'soccer', label: 'Soccer', categoryFilter: 'Soccer' },
];

/** Map category to default publisher */
const CATEGORY_PUBLISHER_MAP: Record<string, string> = {
  'Pokemon': 'The Pokémon Company',
  'Pokémon': 'The Pokémon Company',
  'One Piece': 'Bandai',
  'Soccer': 'Panini',
};

interface CardPickerDialogProps {
  onSelect: (card: SelectedCatalogCard) => void;
}

export function CardPickerDialog({ onSelect }: CardPickerDialogProps) {
  const { locale } = useLocalization();
  const tabs = locale === 'vi-VN'
    ? [
      { id: 'all', label: 'Tất cả', categoryFilter: null },
      { id: 'pokemon', label: 'Pokémon', categoryFilter: 'Pokemon' },
      { id: 'onepiece', label: 'One Piece', categoryFilter: 'One Piece' },
      { id: 'soccer', label: 'Soccer', categoryFilter: 'Soccer' },
    ]
    : locale === 'ja-JP'
      ? [
        { id: 'all', label: 'すべて', categoryFilter: null },
        { id: 'pokemon', label: 'ポケモン', categoryFilter: 'Pokemon' },
        { id: 'onepiece', label: 'ワンピース', categoryFilter: 'One Piece' },
        { id: 'soccer', label: 'サッカー', categoryFilter: 'Soccer' },
      ]
      : [
        { id: 'all', label: 'All', categoryFilter: null },
        { id: 'pokemon', label: 'Pokemon', categoryFilter: 'Pokemon' },
        { id: 'onepiece', label: 'One Piece', categoryFilter: 'One Piece' },
        { id: 'soccer', label: 'Soccer', categoryFilter: 'Soccer' },
      ];
  const copy = locale === 'vi-VN'
    ? {
      trigger: 'Chọn thẻ từ bộ sưu tập',
      title: 'Chọn thẻ từ bộ sưu tập của bạn',
      loginRequired: 'Vui lòng đăng nhập để xem bộ sưu tập',
      searchPlaceholder: 'Tìm kiếm trong bộ sưu tập...',
      loading: 'Đang tải...',
      empty: 'Không tìm thấy thẻ nào trong bộ sưu tập',
      emptyHint: 'Hãy thêm thẻ vào bộ sưu tập trước khi đăng bán',
      goToCollection: 'Đi tới bộ sưu tập',
    }
    : locale === 'ja-JP'
      ? {
        trigger: 'コレクションからカードを選択',
        title: 'あなたのコレクションからカードを選択',
        loginRequired: 'コレクションを見るにはログインしてください',
        searchPlaceholder: 'コレクション内を検索...',
        loading: '読み込み中...',
        empty: 'コレクションにカードが見つかりません',
        emptyHint: '出品する前にコレクションへカードを追加してください',
        goToCollection: 'コレクションへ移動',
      }
      : {
        trigger: 'Choose from collection',
        title: 'Choose a card from your collection',
        loginRequired: 'Please log in to view your collection',
        searchPlaceholder: 'Search your collection...',
        loading: 'Loading...',
        empty: 'No cards found in your collection',
        emptyHint: 'Add cards to your collection before listing them for sale',
        goToCollection: 'Go to collection',
      };
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  const fetchCards = useCallback(async (tab: string, query: string) => {
    if (!user) return;

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      let dbQuery = supabase
        .from('user_collections')
        .select('id, user_id, title, price, image_url, category, market_price, rarity')
        .eq('user_id', user.id);

      // Filter by category tab
      const tabConfig = tabs.find(t => t.id === tab);
      if (tabConfig?.categoryFilter) {
        dbQuery = dbQuery.eq('category', tabConfig.categoryFilter);
      }

      // Search by title
      if (query.trim()) {
        dbQuery = dbQuery.ilike('title', `%${query.trim()}%`);
      }

      const { data, error } = await dbQuery
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setCards(data || []);
    } catch (err) {
      console.error('Failed to fetch collection cards:', err);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch when dialog opens or tab/search changes
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => fetchCards(activeTab, search), 300);
    return () => clearTimeout(timer);
  }, [open, activeTab, search, fetchCards]);

  const handleSelect = (card: CollectionCard) => {
    const category = card.category || 'Pokémon';
    const publisher = CATEGORY_PUBLISHER_MAP[category] || '';

    onSelect({
      name: card.title,
      category: category,
      publisher: publisher,
      setName: '',
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
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">{copy.title}</DialogTitle>
        </DialogHeader>

        {!user ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Library className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{copy.loginRequired}</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setSearch(''); }}>
            <TabsList className="grid grid-cols-4 w-full max-w-[400px]">
              {tabs.map(tab => (
                <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
              ))}
            </TabsList>

            {/* Search */}
            <div className="relative mt-4">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={copy.searchPlaceholder}
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
                  <span className="ml-2 text-muted-foreground">{copy.loading}</span>
                </div>
              ) : cards.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {cards.map(card => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => handleSelect(card)}
                      className="group relative rounded-lg border border-border/50 bg-card overflow-hidden text-left hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {/* Image */}
                      <div className="relative aspect-[3/4] bg-muted/30">
                        {card.image_url ? (
                          <Image
                            src={card.image_url}
                            alt={card.title}
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
                        {/* Category badge */}
                        {card.category && (
                          <span className="absolute top-1.5 left-1.5 bg-primary/80 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            {card.category}
                          </span>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-2">
                        <p className="text-xs font-medium line-clamp-2 leading-tight">{card.title}</p>
                        {card.rarity && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{card.rarity}</p>
                        )}
                      </div>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Library className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">{copy.empty}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {copy.emptyHint}
                  </p>
                  <Link href="/collection" className="mt-3">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Library className="h-4 w-4" />
                      {copy.goToCollection}
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
