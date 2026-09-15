import type { Card } from '@/lib/types';

export type MarketplaceFacets = {
  publishers: string[];
  sets: string[];
  conditions: string[];
  categories: Record<string, number>;
};
export type MarketplacePage = {
  cards: Card[];
  count: number;
  total: number;
  page: number;
  facets: MarketplaceFacets;
};
