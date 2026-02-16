"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Library, FolderOpen, Plus, Search, TrendingUp, TrendingDown,
    Grid3X3, List, Filter, Share2, MoreVertical, Trash2, Edit,
    DollarSign, Package, Star, Sparkles
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCurrency } from "@/contexts/currency-context";
import { useLocalization } from "@/context/localization-context";

// Types based on existing schema
interface CollectionCard {
    id: string;
    user_id: string;
    title: string;
    price: string | null;
    image_url: string | null;
    ebay_link: string | null;
    created_at: string;
    category: string | null;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    market_price: number | null;
    rarity: string | null;
    album_id: string | null;
}

interface Album {
    id: string;
    user_id: string;
    name: string;
    cover_image_url: string | null;
    created_at: string;
    card_count?: number;
    total_value?: number;
}

export default function CollectionPage() {
    const supabase = useSupabase();
    const { user, isLoading: isUserLoading } = useUser();
    const { setOpen } = useAuthModal();

    const [cards, setCards] = useState<CollectionCard[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("all");

    // Use centralized currency formatting
    const { formatPrice } = useCurrency();
    const { t } = useLocalization();

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [cardToDelete, setCardToDelete] = useState<string | null>(null);

    // Initial click handler - opens modal
    const removeCard = useCallback((cardId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setCardToDelete(cardId);
        setDeleteModalOpen(true);
    }, []);

    // Actual delete handler
    const confirmDelete = async () => {
        if (!cardToDelete) return;

        try {
            const { error } = await supabase
                .from('user_collections')
                .delete()
                .eq('id', cardToDelete);

            if (error) {
                console.error('Error removing card:', error);
                return;
            }

            setCards(prev => prev.filter(c => c.id !== cardToDelete));
            setDeleteModalOpen(false);
            setCardToDelete(null);
        } catch (err) {
            console.error('Error removing card:', err);
        }
    };

    // Calculate collection stats
    const stats = useMemo(() => {
        const totalCards = cards.length;
        const totalValue = cards.reduce((sum, card) => sum + (card.market_price || 0), 0);
        const mostValuable = cards.reduce((max, card) =>
            (card.market_price || 0) > (max?.market_price || 0) ? card : max, cards[0]);
        const categories = [...new Set(cards.map(c => c.category).filter(Boolean))];
        return { totalCards, totalValue, mostValuable, categories };
    }, [cards]);

    // Filter cards
    const filteredCards = useMemo(() => {
        let filtered = cards;

        // Filter by album
        if (selectedAlbum) {
            filtered = filtered.filter(c => c.album_id === selectedAlbum);
        }

        // Filter by search
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(c =>
                c.title.toLowerCase().includes(term) ||
                c.category?.toLowerCase().includes(term) ||
                c.rarity?.toLowerCase().includes(term)
            );
        }

        // Filter by tab
        if (activeTab === "pokemon") {
            filtered = filtered.filter(c => c.category === 'Pokemon');
        } else if (activeTab === "onepiece") {
            filtered = filtered.filter(c => c.category === 'One Piece');
        } else if (activeTab === "soccer") {
            filtered = filtered.filter(c => c.category === 'Soccer');
        }

        return filtered;
    }, [cards, searchTerm, selectedAlbum, activeTab]);

    // Fetch collection data
    useEffect(() => {
        if (!user) {
            setIsLoading(false);
            return;
        }

        const fetchData = async () => {
            try {
                // Fetch user's cards
                const { data: cardsData, error: cardsError } = await supabase
                    .from('user_collections')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (cardsData && !cardsError) {
                    setCards(cardsData);
                }

                // Fetch user's albums
                const { data: albumsData, error: albumsError } = await supabase
                    .from('albums')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (albumsData && !albumsError) {
                    // Calculate card counts and values for each album
                    const albumsWithStats: Album[] = albumsData.map((album: Album) => {
                        const albumCards = (cardsData || []).filter((c: CollectionCard) => c.album_id === album.id);
                        return {
                            ...album,
                            card_count: albumCards.length,
                            total_value: albumCards.reduce((sum: number, c: CollectionCard) => sum + (c.market_price || 0), 0)
                        };
                    });
                    setAlbums(albumsWithStats);
                }
            } catch (error) {
                console.error("Error fetching collection:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [user, supabase]);

    // Show login prompt if not logged in
    if (!isUserLoading && !user) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-16 text-center min-h-[60vh] flex flex-col items-center justify-center">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                        <Library className="h-10 w-10 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold mb-3">{t('coll_sign_in_title')}</h1>
                    <p className="text-muted-foreground mb-6 max-w-md">
                        {t('coll_sign_in_desc')}
                    </p>
                    <Button size="lg" onClick={() => setOpen(true)} className="gap-2">
                        <Sparkles className="h-4 w-4" />
                        {t('coll_sign_in_btn')}
                    </Button>
                </div>
                <Footer />
            </>
        );
    }

    if (isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8">
                    <Skeleton className="h-40 w-full rounded-2xl mb-6" />
                    <div className="flex gap-4 mb-6">
                        <Skeleton className="h-10 w-32" />
                        <Skeleton className="h-10 w-32" />
                        <Skeleton className="h-10 flex-1" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {[...Array(12)].map((_, i) => (
                            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
                        ))}
                    </div>
                </div>
                <Footer />
            </>
        );
    }

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8">
                {/* Collection Header Stats */}
                <div className="bg-gradient-to-r from-primary/20 via-purple-500/10 to-blue-500/10 rounded-2xl p-6 md:p-8 mb-8 border border-primary/20">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3">
                                <Library className="h-8 w-8 text-primary" />
                                {t('coll_my_collection')}
                            </h1>
                            <p className="text-muted-foreground">
                                {t('coll_subtitle')}
                            </p>
                        </div>
                        <Button className="gap-2 shrink-0">
                            <Plus className="h-4 w-4" />
                            {t('coll_add_card')}
                        </Button>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 border border-white/5">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <Package className="h-4 w-4" />
                                <span className="text-sm">{t('coll_total_cards')}</span>
                            </div>
                            <p className="text-2xl font-bold">{stats.totalCards}</p>
                        </div>
                        <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 border border-white/5">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <DollarSign className="h-4 w-4" />
                                <span className="text-sm">{t('coll_total_value')}</span>
                            </div>
                            <p className="text-lg md:text-2xl font-bold text-green-500 truncate">{formatPrice(stats.totalValue)}</p>
                        </div>
                        <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 border border-white/5">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <FolderOpen className="h-4 w-4" />
                                <span className="text-sm">{t('coll_albums')}</span>
                            </div>
                            <p className="text-2xl font-bold">{albums.length}</p>
                        </div>
                        <div className="bg-background/50 backdrop-blur-sm rounded-xl p-4 border border-white/5 overflow-hidden">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <Star className="h-4 w-4" />
                                <span className="text-sm">{t('coll_most_valuable')}</span>
                            </div>
                            <p className="text-lg font-bold truncate">
                                {stats.mostValuable ? formatPrice(stats.mostValuable.market_price) : "N/A"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Albums Section */}
                {albums.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                <FolderOpen className="h-5 w-5 text-primary" />
                                {t('coll_albums')}
                            </h2>
                            <Button variant="ghost" size="sm" className="gap-1">
                                <Plus className="h-4 w-4" />
                                {t('coll_new_album')}
                            </Button>
                        </div>
                        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                            {/* All Cards Button */}
                            <button
                                onClick={() => setSelectedAlbum(null)}
                                className={`shrink-0 w-32 h-32 rounded-xl border-2 transition-all ${selectedAlbum === null
                                    ? "border-primary bg-primary/10"
                                    : "border-white/10 bg-white/5 hover:border-white/20"
                                    } flex flex-col items-center justify-center gap-2`}
                            >
                                <Grid3X3 className="h-8 w-8 text-primary" />
                                <span className="text-sm font-medium">{t('coll_all_cards')}</span>
                                <span className="text-xs text-muted-foreground">{cards.length} {t('coll_cards_label')}</span>
                            </button>

                            {/* Album Cards */}
                            {albums.map((album) => (
                                <button
                                    key={album.id}
                                    onClick={() => setSelectedAlbum(album.id)}
                                    className={`shrink-0 w-32 h-32 rounded-xl border-2 transition-all overflow-hidden ${selectedAlbum === album.id
                                        ? "border-primary"
                                        : "border-white/10 hover:border-white/20"
                                        }`}
                                >
                                    {album.cover_image_url ? (
                                        <div className="relative w-full h-full">
                                            <Image
                                                src={album.cover_image_url}
                                                alt={album.name}
                                                fill
                                                className="object-cover"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                                            <div className="absolute bottom-0 left-0 right-0 p-2">
                                                <p className="text-sm font-medium truncate">{album.name}</p>
                                                <p className="text-xs text-muted-foreground">{album.card_count} {t('coll_cards_label')}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-white/5">
                                            <FolderOpen className="h-8 w-8 text-muted-foreground" />
                                            <span className="text-sm font-medium truncate px-2">{album.name}</span>
                                            <span className="text-xs text-muted-foreground">{album.card_count} {t('coll_cards_label')}</span>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
                        <TabsList className="grid grid-cols-4 w-full md:w-auto">
                            <TabsTrigger value="all">{t('coll_tab_all')}</TabsTrigger>
                            <TabsTrigger value="pokemon">{t('coll_tab_pokemon')}</TabsTrigger>
                            <TabsTrigger value="onepiece">{t('coll_tab_onepiece')}</TabsTrigger>
                            <TabsTrigger value="soccer">{t('coll_tab_soccer')}</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="flex gap-2 flex-1">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t('coll_search_placeholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="flex border rounded-lg overflow-hidden">
                            <Button
                                variant={viewMode === "grid" ? "secondary" : "ghost"}
                                size="icon"
                                onClick={() => setViewMode("grid")}
                            >
                                <Grid3X3 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant={viewMode === "list" ? "secondary" : "ghost"}
                                size="icon"
                                onClick={() => setViewMode("list")}
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Cards Grid */}
                {filteredCards.length > 0 ? (
                    <div className={viewMode === "grid"
                        ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4"
                        : "space-y-3"
                    }>
                        {filteredCards.map((card) => (
                            viewMode === "grid" ? (
                                <Link href={`/collection/${card.id}`} key={card.id}>
                                    <Card className="group overflow-hidden hover:border-primary/50 transition-all cursor-pointer">
                                        <div className="relative aspect-[3/4]">
                                            {card.image_url ? (
                                                <Image
                                                    src={card.image_url}
                                                    alt={card.title}
                                                    fill
                                                    className="object-cover group-hover:scale-105 transition-transform"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-muted flex items-center justify-center">
                                                    <Package className="h-12 w-12 text-muted-foreground" />
                                                </div>
                                            )}
                                            {card.rarity && (
                                                <Badge className="absolute top-2 left-2 text-xs hidden sm:inline-flex">
                                                    {card.rarity}
                                                </Badge>
                                            )}
                                        </div>
                                        <CardContent className="p-2 sm:p-3">
                                            <p className="font-medium text-sm truncate mb-1">{card.title}</p>
                                            <div className="flex items-center justify-between">
                                                <span className="text-primary font-bold text-sm truncate">
                                                    {formatPrice(card.market_price)}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                                    onClick={(e) => removeCard(card.id, e)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ) : (
                                <Link href={`/collection/${card.id}`} key={card.id}>
                                    <Card className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4 hover:border-primary/50 transition-all cursor-pointer">
                                        <div className="relative w-12 h-16 sm:w-16 sm:h-20 shrink-0 rounded-lg overflow-hidden">
                                            {card.image_url ? (
                                                <Image
                                                    src={card.image_url}
                                                    alt={card.title}
                                                    fill
                                                    className="object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-muted flex items-center justify-center">
                                                    <Package className="h-6 w-6 text-muted-foreground" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{card.title}</p>
                                            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                                                {card.rarity && <Badge variant="outline" className="text-xs">{card.rarity}</Badge>}
                                                {card.category && <span>{card.category}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 max-w-[45%] sm:max-w-[40%] flex items-center gap-2">
                                            <div className="text-right">
                                                <p className="text-primary font-bold truncate">{formatPrice(card.market_price)}</p>
                                                {card.low_price && card.high_price && (
                                                    <p className="text-xs text-muted-foreground truncate hidden sm:block">
                                                        {formatPrice(card.low_price)} - {formatPrice(card.high_price)}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                                onClick={(e) => removeCard(card.id, e)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </Card>
                                </Link>
                            )
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 border border-dashed rounded-xl">
                        <Library className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        {cards.length === 0 ? (
                            <>
                                <h3 className="text-xl font-semibold mb-2">{t('coll_start_title')}</h3>
                                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                    {t('coll_start_desc')}
                                </p>
                                <Button className="gap-2">
                                    <Plus className="h-4 w-4" />
                                    {t('coll_add_first_card')}
                                </Button>
                            </>
                        ) : (
                            <>
                                <h3 className="text-xl font-semibold mb-2">{t('coll_no_cards_found')}</h3>
                                <p className="text-muted-foreground">
                                    {t('coll_adjust_filters')}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {/* Delete Confirmation Modal */}
                <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('coll_delete_title')}</DialogTitle>
                            <DialogDescription>
                                {t('coll_delete_desc')}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
                                {t('coll_cancel')}
                            </Button>
                            <Button variant="destructive" onClick={confirmDelete}>
                                {t('coll_confirm_delete')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>
            <Footer />
        </>
    );
}
