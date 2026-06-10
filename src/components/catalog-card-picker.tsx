'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, SearchCheck } from 'lucide-react';
import Image from 'next/image';

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
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<CatalogTabId>('pokemon-en');
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<CatalogPick[]>([]);
    const [loading, setLoading] = useState(false);

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
                    Chọn thẻ từ catalog
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Tìm đúng lá thẻ trong catalog</DialogTitle>
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
                        placeholder={tab === 'soccer' ? 'Tìm theo tên cầu thủ hoặc số thẻ...' : 'Tìm theo tên thẻ hoặc số thẻ (vd: 199/197)...'}
                        className="pl-9"
                        autoFocus
                    />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                    {loading ? (
                        <div className="flex items-center justify-center p-8 text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tìm...
                        </div>
                    ) : results.length === 0 ? (
                        <p className="p-8 text-center text-sm text-muted-foreground">
                            {search.trim().length < 2
                                ? 'Nhập ít nhất 2 ký tự để tìm.'
                                : 'Không tìm thấy. Bạn vẫn có thể nhập số thẻ thủ công trong form.'}
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
