'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/supabase';
import { MagnifyingGlass, SpinnerGap } from '@phosphor-icons/react';
import { Package, Library, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocalization } from '@/context/localization-context';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useToast } from '@/hooks/use-toast';
import type { CollectionListingSource } from '@/lib/collection-card';

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

export type SelectedCollectionCard = CollectionListingSource;

interface CardPickerDialogProps {
  onSelect: (card: SelectedCollectionCard) => void;
}

export function CardPickerDialog({ onSelect }: CardPickerDialogProps) {
  const { locale } = useLocalization();
  const tabs = locale === 'vi-VN'
    ? [
      { id: 'all', label: 'Tất cả' },
      { id: 'pokemon', label: 'Pokémon' },
      { id: 'onepiece', label: 'One Piece' },
      { id: 'soccer', label: 'Bóng đá' },
    ]
    : locale === 'ja-JP'
      ? [
        { id: 'all', label: 'すべて' },
        { id: 'pokemon', label: 'ポケモン' },
        { id: 'onepiece', label: 'ワンピース' },
        { id: 'soccer', label: 'サッカー' },
      ]
      : [
        { id: 'all', label: 'All' },
        { id: 'pokemon', label: 'Pokemon' },
        { id: 'onepiece', label: 'One Piece' },
        { id: 'soccer', label: 'Soccer' },
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
      resolveError: 'Không thể lấy thông tin thẻ này. Vui lòng thử lại.',
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
        resolveError: 'このカードの情報を取得できません。もう一度お試しください。',
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
        resolveError: 'Could not load this card. Please try again.',
      };
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const { user } = useUser();
  const { toast } = useToast();
  // On phones the centered Dialog fights the iOS keyboard (fixed + vh don't track the
  // visual viewport), so render a vaul bottom sheet there instead. Same pattern as
  // the shop-shipping drawer on /sell.
  const desktop = useMediaQuery('(min-width: 768px)');

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
      const categoryFilters = tab === 'pokemon'
        ? ['Pokémon', 'Pokemon']
        : tab === 'onepiece'
          ? ['One Piece']
          : tab === 'soccer' ? ['Bóng đá', 'Soccer'] : null;
      if (categoryFilters) {
        dbQuery = dbQuery.in('category', categoryFilters);
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

  const handleSelect = async (card: CollectionCard) => {
    setResolvingId(card.id);
    try {
      const response = await fetch(`/api/collection/${card.id}/listing-source`, {
        method: 'POST',
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      onSelect(result as SelectedCollectionCard);
      setOpen(false);
      setSearch('');
    } catch (error) {
      console.error('Failed to resolve collection card:', error);
      toast({ variant: 'destructive', title: copy.resolveError });
    } finally {
      setResolvingId(null);
    }
  };

  const trigger = (
    <Button type="button" variant="outline" className="gap-2 border-dashed border-primary/40 hover:border-primary text-primary">
      <Package className="h-4 w-4" />
      {copy.trigger}
    </Button>
  );

  const body = !user ? (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Library className="h-12 w-12 text-muted-foreground/30 mb-3" />
      <p className="text-muted-foreground">{copy.loginRequired}</p>
    </div>
  ) : (
    <Tabs
      value={activeTab}
      onValueChange={(val) => { setActiveTab(val); setSearch(''); }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full max-w-[400px]">
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
          // Only steal focus where there is no virtual keyboard to pop up.
          autoFocus={desktop}
          enterKeyHint="search"
          onKeyDown={(e) => {
            // Results already refetch on every keystroke; "Search" on the soft
            // keyboard just dismisses it so the grid is visible again.
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>

      {/* Results */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
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
                disabled={resolvingId !== null}
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
                {resolvingId === card.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                    <SpinnerGap className="h-6 w-6 animate-spin text-primary" weight="bold" />
                  </div>
                )}
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
  );

  if (!desktop) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        {/* Fixed height (not max-h) so the list has a real scroll box and the sheet
            doesn't jump when results load; dvh dodges Safari's URL bar. vaul keeps
            the sheet above the keyboard via visualViewport (repositionInputs). */}
        <DrawerContent className="h-[88dvh] px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <DrawerHeader className="relative px-0 pt-2 pb-3 text-left">
            <DrawerTitle className="pr-8 text-lg">{copy.title}</DrawerTitle>
            <DrawerClose
              className="absolute right-0 top-2 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">{copy.title}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
