export type CollectionCatalogPick = {
  kind: 'tcgcsv' | 'soccer';
  productId?: number;
  soccerId?: number;
  name: string;
  setName: string | null;
  number: string | null;
  language: 'en' | 'jp' | null;
  imageUrl: string | null;
  rarity: string | null;
  marketPrice?: number | null;
};

export type CollectionListingSource = {
  id: string;
  name: string;
  category: string;
  publisher: string;
  setName: string;
  imageUrl: string;
  rarity: string | null;
  catalogPick: CollectionCatalogPick | null;
  resolution: 'linked' | 'resolved' | 'unresolved' | 'not_required';
};

export function normalizeCollectionCategory(category?: string | null): string {
  const value = category?.trim().toLowerCase();
  if (value === 'pokemon' || value === 'pokémon') return 'Pokémon';
  if (value === 'soccer' || value === 'football' || value === 'bóng đá') return 'Bóng đá';
  if (value === 'one piece' || value === 'onepiece') return 'One Piece';
  return category?.trim() || 'Khác';
}

export function collectionPublisher(category: string): string {
  if (category === 'Pokémon') return 'The Pokémon Company';
  if (category === 'One Piece') return 'Bandai';
  return '';
}

export function catalogLanguage(categoryId?: number | null): 'en' | 'jp' | null {
  return categoryId === 85 ? 'jp' : categoryId === 3 || categoryId === 68 ? 'en' : null;
}

export function catalogCollectionCategory(categoryId?: number | null): string {
  return categoryId === 68 ? 'One Piece' : 'Pokémon';
}
