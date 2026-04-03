/**
 * Card Catalog — Category configuration & DB-driven set fetching
 *
 * Sets for Pokemon and One Piece are fetched from the existing `tcgcsv_products`
 * table / materialized views in Supabase.
 * For other categories (Soccer, Basketball, etc.), we use curated static lists.
 */

import { getSupabaseClient } from '@/lib/supabase/client';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface CategoryConfig {
  /** Display label (Vietnamese) */
  label: string;
  /** Display label (English) */
  labelEn: string;
  /** Internal value stored in DB */
  value: string;
  /** Whether this category uses seasons */
  hasSeasons: boolean;
  /** Available publishers for this category */
  publishers: PublisherConfig[];
  /** Predefined seasons. Only used when hasSeasons = true */
  seasons?: string[];
  /** Whether to allow free-text entry for set/publisher (for "Other" category) */
  freeText?: boolean;
  /** Whether sets should be fetched from the DB instead of using static list */
  dbSets?: boolean;
  /** DB source config for fetching sets dynamically */
  dbSetSource?: {
    /** Table or view name to query */
    view?: string;
    /** Additional view for JP sets (Pokemon) */
    viewJp?: string;
    /** category_id to filter tcgcsv_products */
    categoryId?: number;
  };
}

export interface PublisherConfig {
  name: string;
  sets: SetConfig[];
}

export interface SetConfig {
  /** Display name */
  name: string;
  /** Short code if any (e.g. "SV01") */
  code?: string;
}

// ────────────────────────────────────────────
// Soccer / Bóng đá — Static sets
// ────────────────────────────────────────────

const SOCCER_PANINI_SETS: SetConfig[] = [
  { name: 'Prizm Premier League' },
  { name: 'Prizm FIFA World Cup' },
  { name: 'Prizm UEFA Euro' },
  { name: 'Prizm La Liga' },
  { name: 'Prizm Serie A' },
  { name: 'Prizm Bundesliga' },
  { name: 'Prizm Ligue 1' },
  { name: 'Select Premier League' },
  { name: 'Select FIFA World Cup' },
  { name: 'Donruss Soccer' },
  { name: 'Donruss Elite' },
  { name: 'Mosaic FIFA World Cup' },
  { name: 'Mosaic Premier League' },
  { name: 'Immaculate Soccer' },
  { name: 'National Treasures Soccer' },
  { name: 'Obsidian Soccer' },
  { name: 'Sticker Album FIFA World Cup' },
  { name: 'Sticker Album UEFA Euro' },
  { name: 'Adrenalyn XL' },
  { name: 'Khác' },
];

const SOCCER_TOPPS_SETS: SetConfig[] = [
  { name: 'Chrome UEFA Club Competitions' },
  { name: 'Chrome Bundesliga' },
  { name: 'Chrome MLS' },
  { name: "Chrome UEFA Women's Champions League" },
  { name: 'Finest UEFA Club Competitions' },
  { name: 'Finest Bundesliga' },
  { name: 'Match Attax UEFA Champions League' },
  { name: 'Match Attax Premier League' },
  { name: 'Match Attax Bundesliga' },
  { name: 'Merlin Heritage UEFA' },
  { name: 'Stadium Club Chrome' },
  { name: 'Inception UEFA' },
  { name: 'UEFA Living Set' },
  { name: 'Now UEFA Champions League' },
  { name: 'Khác' },
];

const SOCCER_SEASONS = [
  '2025-26', '2024-25', '2023-24', '2022-23', '2021-22',
  '2020-21', '2019-20', '2018-19', '2017-18',
  'FIFA World Cup 2022', 'UEFA Euro 2024', 'UEFA Euro 2020',
  'FIFA World Cup 2018', 'Khác',
];

// ────────────────────────────────────────────
// Basketball / Bóng rổ — Static sets
// ────────────────────────────────────────────

const BASKETBALL_PANINI_SETS: SetConfig[] = [
  { name: 'Prizm NBA' },
  { name: 'Select NBA' },
  { name: 'Mosaic NBA' },
  { name: 'Donruss NBA' },
  { name: 'Hoops NBA' },
  { name: 'Immaculate NBA' },
  { name: 'National Treasures NBA' },
  { name: 'Court Kings NBA' },
  { name: 'Contenders NBA' },
  { name: 'Revolution NBA' },
  { name: 'Obsidian NBA' },
  { name: 'Origins NBA' },
  { name: 'Spectra NBA' },
  { name: 'Khác' },
];

const BASKETBALL_SEASONS = [
  '2025-26', '2024-25', '2023-24', '2022-23', '2021-22',
  '2020-21', '2019-20', '2018-19', 'Khác',
];

// ────────────────────────────────────────────
// Yu-Gi-Oh — Static sets (popular ones)
// ────────────────────────────────────────────

const YUGIOH_SETS: SetConfig[] = [
  { name: 'The Infinite Forbidden', code: 'INFO' },
  { name: 'Rage of the Abyss', code: 'ROTA' },
  { name: 'Legacy of Destruction', code: 'LEDE' },
  { name: 'Phantom Nightmare', code: 'PHNI' },
  { name: 'Age of Overlord', code: 'AGOV' },
  { name: 'Duelist Nexus', code: 'DUNE' },
  { name: 'Cyberstorm Access', code: 'CYAC' },
  { name: 'Darkwing Blast', code: 'DABL' },
  { name: 'Power of the Elements', code: 'POTE' },
  { name: 'Dimension Force', code: 'DIFO' },
  { name: '25th Anniversary Rarity Collection', code: 'RA02' },
  { name: 'Maximum Gold: El Dorado', code: 'MGED' },
  { name: 'Ghosts From the Past', code: 'GFTP' },
  { name: 'Legendary Duelists Collections' },
  { name: 'Structure Deck' },
  { name: 'Legend of Blue-Eyes White Dragon', code: 'LOB' },
  { name: 'Metal Raiders', code: 'MRD' },
  { name: 'Khác', code: 'OTHER' },
];

// ────────────────────────────────────────────
// F1 — Static sets
// ────────────────────────────────────────────

const F1_TOPPS_SETS: SetConfig[] = [
  { name: 'Chrome Formula 1' },
  { name: 'Finest Formula 1' },
  { name: 'Turbo Attax Formula 1' },
  { name: 'Dynasty Formula 1' },
  { name: 'Chrome Sapphire Formula 1' },
  { name: 'Now Formula 1' },
  { name: 'Khác' },
];

const F1_SEASONS = [
  '2025', '2024', '2023', '2022', '2021', '2020', 'Khác',
];

// ────────────────────────────────────────────
// Main Catalog Export
// ────────────────────────────────────────────

export const CARD_CATALOG: CategoryConfig[] = [
  {
    label: 'Pokémon',
    labelEn: 'Pokémon',
    value: 'Pokémon',
    hasSeasons: false,
    dbSets: true,
    dbSetSource: { view: 'pokemon_sets_en', viewJp: 'pokemon_sets_jp' },
    publishers: [
      { name: 'The Pokémon Company', sets: [] }, // sets loaded from DB
    ],
  },
  {
    label: 'Bóng đá',
    labelEn: 'Soccer',
    value: 'Bóng đá',
    hasSeasons: true,
    seasons: SOCCER_SEASONS,
    publishers: [
      { name: 'Panini', sets: SOCCER_PANINI_SETS },
      { name: 'Topps', sets: SOCCER_TOPPS_SETS },
    ],
  },
  {
    label: 'Bóng rổ',
    labelEn: 'Basketball',
    value: 'Bóng rổ',
    hasSeasons: true,
    seasons: BASKETBALL_SEASONS,
    publishers: [
      { name: 'Panini', sets: BASKETBALL_PANINI_SETS },
    ],
  },
  {
    label: 'One Piece',
    labelEn: 'One Piece',
    value: 'One Piece',
    hasSeasons: false,
    dbSets: true,
    dbSetSource: { categoryId: 68 },
    publishers: [
      { name: 'Bandai', sets: [] }, // sets loaded from DB
    ],
  },
  {
    label: 'Yu-Gi-Oh',
    labelEn: 'Yu-Gi-Oh',
    value: 'Yu-Gi-Oh',
    hasSeasons: false,
    publishers: [
      { name: 'Konami', sets: YUGIOH_SETS },
    ],
  },
  {
    label: 'F1',
    labelEn: 'F1',
    value: 'F1',
    hasSeasons: true,
    seasons: F1_SEASONS,
    publishers: [
      { name: 'Topps', sets: F1_TOPPS_SETS },
    ],
  },
  {
    label: 'Khác',
    labelEn: 'Other',
    value: 'Khác',
    hasSeasons: true,
    freeText: true,
    seasons: [],
    publishers: [],
  },
];

// ────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────

/** Get category config by value */
export function getCategoryConfig(categoryValue: string): CategoryConfig | undefined {
  return CARD_CATALOG.find(c => c.value === categoryValue || c.labelEn === categoryValue);
}

/** Get display categories for locale */
export function getCategories(locale: string): { label: string; value: string }[] {
  return CARD_CATALOG.map(c => ({
    label: locale === 'en-US' ? c.labelEn : c.label,
    value: c.value,
  }));
}

/** Get publishers for a category */
export function getPublishers(categoryValue: string): string[] {
  const config = getCategoryConfig(categoryValue);
  if (!config) return [];
  return config.publishers.map(p => p.name);
}

/** Get STATIC sets for a category + publisher combo (for non-DB categories) */
export function getStaticSets(categoryValue: string, publisherName?: string): SetConfig[] {
  const config = getCategoryConfig(categoryValue);
  if (!config || config.dbSets) return [];

  if (publisherName) {
    const pub = config.publishers.find(p => p.name === publisherName);
    return pub ? pub.sets : [];
  }

  if (config.publishers.length === 1) {
    return config.publishers[0].sets;
  }

  return config.publishers.flatMap(p => p.sets);
}

/**
 * Fetch sets from the database for DB-driven categories (Pokemon, One Piece).
 * Returns a deduplicated, sorted array of non-empty set names.
 */
export async function fetchDbSets(categoryValue: string): Promise<string[]> {
  const config = getCategoryConfig(categoryValue);
  if (!config?.dbSets || !config.dbSetSource) return [];

  const supabase = getSupabaseClient();
  const allSetNames: string[] = [];

  try {
    // Fetch from primary view (e.g. pokemon_sets_en)
    if (config.dbSetSource.view) {
      const { data, error } = await supabase
        .from(config.dbSetSource.view)
        .select('set_name');

      if (!error && data) {
        for (const d of data) {
          const name = (d as any).set_name;
          if (name && typeof name === 'string' && name.trim()) {
            allSetNames.push(name.trim());
          }
        }
      }
    }

    // Fetch from JP view if exists (e.g. pokemon_sets_jp)
    if (config.dbSetSource.viewJp) {
      const { data, error } = await supabase
        .from(config.dbSetSource.viewJp)
        .select('set_name');

      if (!error && data) {
        for (const d of data) {
          const name = (d as any).set_name;
          if (name && typeof name === 'string' && name.trim()) {
            allSetNames.push(name.trim());
          }
        }
      }
    }

    // Fetch from tcgcsv_products by category_id
    if (config.dbSetSource.categoryId) {
      const { data, error } = await supabase
        .from('tcgcsv_products')
        .select('set_name')
        .eq('category_id', config.dbSetSource.categoryId)
        .not('set_name', 'is', null)
        .limit(2000);

      if (!error && data) {
        for (const d of data) {
          const name = (d as any).set_name;
          if (name && typeof name === 'string' && name.trim()) {
            allSetNames.push(name.trim());
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch DB sets for', categoryValue, err);
  }

  // Deduplicate and sort
  const unique = Array.from(new Set(allSetNames)).sort();
  return unique;
}

/** Get seasons for a category */
export function getSeasons(categoryValue: string): string[] {
  const config = getCategoryConfig(categoryValue);
  if (!config || !config.hasSeasons) return [];
  return config.seasons || [];
}

/** Check if category has single publisher (auto-select) */
export function isSinglePublisher(categoryValue: string): boolean {
  const config = getCategoryConfig(categoryValue);
  return !!config && config.publishers.length === 1;
}

/** Check if category allows free text input */
export function isFreeText(categoryValue: string): boolean {
  const config = getCategoryConfig(categoryValue);
  return !!config?.freeText;
}

/** Check if category uses DB-driven sets */
export function isDbSets(categoryValue: string): boolean {
  const config = getCategoryConfig(categoryValue);
  return !!config?.dbSets;
}
