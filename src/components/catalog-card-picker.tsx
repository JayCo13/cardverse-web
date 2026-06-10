'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, SearchCheck } from 'lucide-react';
import Image from 'next/image';
import { useLocalization } from '@/context/localization-context';

// Picker over the REAL catalogs (tcgcsv_products + soccer_cards) so a listing
// carries a canonical card identity (product_id / soccer_id + number +
// language). This is different from CardPickerDialog, which picks from the
// seller's own collection and has no catalog key.

export type CatalogPick = {
    kind: 'tcgcsv' | 'soccer';
    productId?: number;
    soccerId?: number;
    name: string;
    setName: string | null;
    number: string | null;
    language: 'en' | 'jp' | null;
    imageUrl: string | null;
    rarity: string | null;
    marketPrice?: number | null; // TCGplayer market price in USD (tcgcsv only)
};

const TABS = [
    { id: 'pokemon-en', label: 'Pokémon EN', appCategory: 'Pokémon' },
    { id: 'pokemon-jp', label: 'Pokémon JP', appCategory: 'Pokémon' },
    { id: 'onepiece', label: 'One Piece', appCategory: 'One Piece' },
    { id: 'soccer', label: 'Bóng đá', appCategory: 'Bóng đá' },
] as const;

export type CatalogTabId = typeof TABS[number]['id'];

/** Map a picker tab to the app's card category string used by the sell form. */
export const catalogTabToCategory = (tab: CatalogTabId): string =>
    TABS.find(t => t.id === tab)?.appCategory || 'Pokémon';

type CatalogCardPickerProps = {
    onSelect: (pick: CatalogPick, tab: CatalogTabId) => void;
};

export function CatalogCardPicker({ onSelect }: CatalogCardPickerProps) {
    const { locale } = useLocalization();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<CatalogTabId>('pokemon-en');
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<CatalogPick[]>([]);
    const [loading, setLoading] = useState(false);
    const copy = locale === 'ja-JP'
        ? {
            button: 'カタログからカードを選ぶ',
            title: 'カタログで正しいカードを探す',
            soccerPlaceholder: '選手名またはカード番号で検索...',
            cardPlaceholder: 'カード名または番号で検索 (例: 199/197)...',
            searching: '検索中...',
            minChars: '検索するには2文字以上入力してください。',
            notFound: '見つかりませんでした。フォームで手動入力することもできます。',
        }
        : locale === 'vi-VN'
            ? {
                button: 'Chọn thẻ từ catalog',
                title: 'Tìm đúng lá thẻ trong catalog',
                soccerPlaceholder: 'Tìm theo tên cầu thủ hoặc số thẻ...',
                cardPlaceholder: 'Tìm theo tên thẻ hoặc số thẻ (vd: 199/197)...',
                searching: 'Đang tìm...',
                minChars: 'Nhập ít nhất 2 ký tự để tìm.',
                notFound: 'Không tìm thấy. Bạn vẫn có thể nhập số thẻ thủ công trong form.',
            }
            : {
                button: 'Choose card from catalog',
                title: 'Find the exact card in the catalog',
                soccerPlaceholder: 'Search by player name or card number...',
                cardPlaceholder: 'Search by card name or number (e.g. 199/197)...',
                searching: 'Searching...',
                minChars: 'Enter at least 2 characters to search.',
                notFound: 'No result found. You can still enter the card number manually in the form.',
            };

    useEffect(() => {
        if (!open || search.trim().length < 2) {
            setResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(search.trim())}&category=${tab}`);
                const data = await res.json();
                setResults(res.ok ? (data.results || []) : []);
            } catch {
                setResults([]);
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [open, search, tab]);

    const handlePick = (pick: CatalogPick) => {
        onSelect(pick, tab);
        setOpen(false);
        setSearch('');
        setResults([]);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button type="button" variant="outline" className="gap-2 border-dashed border-orange-500/40 hover:border-orange-500 text-orange-500">
                    <SearchCheck className="h-4 w-4" />
                    {copy.button}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                </DialogHeader>

                <Tabs value={tab} onValueChange={(v) => { setTab(v as CatalogTabId); setResults([]); }}>
                    <TabsList className="grid w-full grid-cols-4">
                        {TABS.map(t => (
                            <TabsTrigger key={t.id} value={t.id} className="text-xs">{t.label}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={tab === 'soccer' ? copy.soccerPlaceholder : copy.cardPlaceholder}
                        className="pl-9"
                        autoFocus
                    />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                    {loading ? (
                        <div className="flex items-center justify-center p-8 text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {copy.searching}
                        </div>
                    ) : results.length === 0 ? (
                        <p className="p-8 text-center text-sm text-muted-foreground">
                            {search.trim().length < 2
                                ? copy.minChars
                                : copy.notFound}
                        </p>
                    ) : (
                        results.map(result => (
                            <button
                                key={`${result.kind}-${result.productId ?? result.soccerId}`}
                                type="button"
                                onClick={() => handlePick(result)}
                                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-orange-500/60 hover:bg-orange-500/5"
                            >
                                <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
                                    {result.imageUrl ? (
                                        <Image src={result.imageUrl} alt="" fill className="object-contain" sizes="48px" />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-lg">⚽️</div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold">{result.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">{result.setName}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        {result.number && <Badge variant="outline" className="text-[10px]">#{result.number}</Badge>}
                                        {result.language && <Badge variant="outline" className="text-[10px] uppercase">{result.language}</Badge>}
                                        {result.rarity && <Badge variant="outline" className="text-[10px]">{result.rarity}</Badge>}
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
