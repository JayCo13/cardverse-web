'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Camera, Loader2, Search, SearchCheck } from 'lucide-react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { isHeicFile, convertHeicToJpeg } from '@/lib/heic';

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

// Downscale + JPEG-encode the photo before sending to the identify edge
// function (mirrors market-spotlight's preprocessImage; raw phone photos are
// 5-10MB which both slows and sometimes breaks the AI call).
const fileToScanBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const maxSide = 1024;
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load')); };
        img.src = url;
    });

export function CatalogCardPicker({ onSelect }: CatalogCardPickerProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<CatalogTabId>('pokemon-en');
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<CatalogPick[]>([]);
    const [loading, setLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const scanInputRef = useRef<HTMLInputElement>(null);

    // Quick scan: photo → identify-card edge function (same one the buyer scan
    // uses) → switch to the right tab and search by the detected number/name so
    // the seller just taps the right candidate.
    const handleScanFile = async (file: File | null | undefined) => {
        if (!file) return;
        setIsScanning(true);
        try {
            const jpeg = isHeicFile(file) ? await convertHeicToJpeg(file) : file;
            const imageBase64 = await fileToScanBase64(jpeg);

            const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/identify-card`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                },
                body: JSON.stringify({ image: imageBase64 }),
            });
            if (!res.ok) throw new Error('AI không nhận diện được, thử lại với ảnh rõ hơn.');
            const identification = await res.json();

            if (identification.is_card === false) {
                throw new Error('Ảnh không phải thẻ bài. Vui lòng chụp lại.');
            }

            const category = String(identification.category || 'pokemon').toLowerCase();
            const language = String(identification.language || '').toLowerCase();
            const detectedTab: CatalogTabId = category.includes('soccer')
                ? 'soccer'
                : category.includes('one')
                    ? 'onepiece'
                    : language.startsWith('ja') ? 'pokemon-jp' : 'pokemon-en';

            const number = identification.card_id || identification.cardNumber || identification.number || '';
            const name = identification.official_en_name || identification.cardName || identification.name || '';
            const query = String(number || name).trim();
            if (!query) throw new Error('Không đọc được tên/số thẻ từ ảnh.');

            setTab(detectedTab);
            setSearch(query);
            toast({
                title: '🔍 Đã nhận diện thẻ',
                description: `${name || 'Thẻ'}${number ? ` · #${number}` : ''} — chọn đúng lá thẻ trong kết quả.`,
            });
        } catch (error) {
            const description = error instanceof Error ? error.message : 'Không quét được ảnh.';
            toast({ variant: 'destructive', title: 'Quét thất bại', description });
        } finally {
            setIsScanning(false);
            if (scanInputRef.current) scanInputRef.current.value = '';
        }
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

                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={tab === 'soccer' ? 'Tìm theo tên cầu thủ hoặc số thẻ...' : 'Tìm theo tên thẻ hoặc số thẻ (vd: 199/197)...'}
                            className="pl-9"
                            autoFocus
                        />
                    </div>
                    <input
                        ref={scanInputRef}
                        type="file"
                        accept="image/*,.heic,.heif"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => void handleScanFile(e.target.files?.[0])}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => scanInputRef.current?.click()}
                        disabled={isScanning}
                        className="shrink-0 gap-2 border-orange-500/40 text-orange-500 hover:border-orange-500"
                    >
                        {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                        Quét ảnh
                    </Button>
                </div>

                {isScanning && (
                    <p className="text-xs text-muted-foreground">Đang nhận diện thẻ từ ảnh, chờ vài giây...</p>
                )}

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
