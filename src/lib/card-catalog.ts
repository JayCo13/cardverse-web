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
  /**
   * Seasons for this category, built on demand. Only used when hasSeasons = true.
   *
   * A function rather than an array because the newest season depends on
   * today's date — see the season section below.
   */
  seasons?: () => string[];
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

/**
 * Two more brands that the catalogue already carries.
 *
 * The crawled `soccer_cards` table has 30 Leaf cards (2017-2025) and 15 Futera
 * (2018-2025), neither of which a seller could pick — so those listings had to
 * be filed under a publisher they do not belong to. The crawl records no set
 * names for either, so these are the brands' own flagship lines.
 */
const SOCCER_LEAF_SETS: SetConfig[] = [
  { name: 'Leaf Metal' },
  { name: 'Leaf Ultimate' },
  { name: 'Leaf Trinity' },
  { name: 'Leaf Best of Soccer' },
  { name: 'Khác' },
];

const SOCCER_FUTERA_SETS: SetConfig[] = [
  { name: 'Futera Unique' },
  { name: 'Futera Ultimates' },
  { name: 'Futera World Football' },
  { name: 'Khác' },
];

// ────────────────────────────────────────────
// Seasons — derived from today's date
// ────────────────────────────────────────────

/**
 * Vietnam is UTC+7 the whole year and has had no DST since 1975, so the offset
 * is a constant and not a timezone lookup.
 *
 * Season lists are built from "now", and "now" is two different answers on the
 * two machines that render this page: Netlify runs in UTC, the sellers are in
 * UTC+7. On the one day a year a season rolls over those two disagree for seven
 * hours, and React would hydrate a season <Select> whose options are not the
 * ones the server sent. Reading the date in Vietnam time on both sides makes it
 * a single answer.
 */
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function vietnamToday(): { year: number; month: number } {
  const local = new Date(Date.now() + VIETNAM_UTC_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}

/** 2026 -> "2026-27". The two-digit tail keeps its zero: 2000 -> "2000-01". */
function splitSeasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Newest-first season labels, from the season a card listed today belongs to
 * back to `oldestStartYear`. A season is named for the year it starts in.
 *
 * The label turns over months before a ball is kicked: the 2026-27 licence is
 * printed and in shops over the summer, so a seller listing a summer release
 * needs that label in June, not in August. `rolloverMonth` is therefore the
 * first month after the previous season ends, not the month the new one starts.
 *
 * Newest first because that is the order sellers pick in — the recent seasons
 * carry most of the listings. Clamped so a device with a badly wrong clock
 * cannot produce an empty list.
 */
function splitSeasonsSince(oldestStartYear: number, rolloverMonth: number): string[] {
  const { year, month } = vietnamToday();
  const newest = Math.max(month >= rolloverMonth ? year : year - 1, oldestStartYear);
  const labels: string[] = [];
  for (let start = newest; start >= oldestStartYear; start--) labels.push(splitSeasonLabel(start));
  return labels;
}

/**
 * Editions of a four-yearly tournament, newest first.
 *
 * Derived rather than appended by hand: the World Cup and the Euros both run on
 * a fixed four-year cadence, so every future edition already follows from one
 * known one and the list stops going stale. An edition appears a year early
 * because its cards do — the albums and Topps boxes for a summer tournament
 * ship the winter before it.
 */
function tournamentEditions(name: string, knownEdition: number, oldestEdition: number): string[] {
  const { year } = vietnamToday();
  const latest = knownEdition + Math.floor((year + 1 - knownEdition) / 4) * 4;
  const editions: string[] = [];
  for (let edition = latest; edition >= oldestEdition; edition -= 4) editions.push(`${name} ${edition}`);
  return editions;
}

/**
 * Seasons run back to 2000-01, then by decade.
 *
 * The list used to stop at 2017-18 while the catalogue holds cards from 1979,
 * so anything vintage fell through to "Khác" and the field stopped being worth
 * filtering on. Before 2000 a season label is not how anyone refers to these
 * cards — the decade is what a vintage listing gets searched by.
 */
function soccerSeasons(): string[] {
  return [
    // European football runs August to May. June is the first month with no
    // fixtures left in it, and it is when the next season's product arrives.
    ...splitSeasonsSince(2000, 6),
    'Thập niên 1990', 'Thập niên 1980', 'Trước 1980',
    // Tournaments are their own product line, not a league season.
    ...tournamentEditions('FIFA World Cup', 2026, 2010),
    ...tournamentEditions('UEFA Euro', 2024, 2012),
    // Copa América stays listed by hand: its cadence is not a formula — 2015,
    // 2016, 2019, 2021, 2024 — so there is nothing to derive the next one from.
    'Copa America 2024', 'Copa America 2021',
    'Khác',
  ];
}

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

/**
 * The NBA league year opens on 1 July — which is also when the draft class and
 * the next season's product lines appear — so that is where the label turns.
 */
function basketballSeasons(): string[] {
  return [...splitSeasonsSince(2018, 7), 'Khác'];
}

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

/**
 * Formula 1 runs inside one calendar year, so a season is just its year. The
 * next year's cards arrive with the car launches, before the year turns over.
 */
function f1Seasons(): string[] {
  const { year, month } = vietnamToday();
  const seasons: string[] = [];
  for (let season = Math.max(month >= 11 ? year + 1 : year, 2020); season >= 2020; season--) {
    seasons.push(String(season));
  }
  return [...seasons, 'Khác'];
}

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
    seasons: soccerSeasons,
    publishers: [
      { name: 'Panini', sets: SOCCER_PANINI_SETS },
      { name: 'Topps', sets: SOCCER_TOPPS_SETS },
      { name: 'Leaf', sets: SOCCER_LEAF_SETS },
      { name: 'Futera', sets: SOCCER_FUTERA_SETS },
      { name: 'Khác', sets: [{ name: 'Khác' }] },
    ],
  },
  {
    label: 'Bóng rổ',
    labelEn: 'Basketball',
    value: 'Bóng rổ',
    hasSeasons: true,
    seasons: basketballSeasons,
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
    seasons: f1Seasons,
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
    // No list: "Khác" is the free-text category, so the seller types the season.

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
  const grouped = await fetchDbSetsGrouped(categoryValue);
  // Merge all groups into a single deduplicated array
  const all = [...grouped.en, ...grouped.jp, ...grouped.other];
  return Array.from(new Set(all)).sort();
}

/** Grouped set result for multi-language categories */
export interface GroupedSets {
  en: string[];
  jp: string[];
  other: string[];
}

/**
 * Fetch sets grouped by language (EN/JP) for categories that have both.
 * For Pokemon: EN = pokemon_sets_en, JP = pokemon_sets_jp
 * For others: all sets go into "other"
 */
export async function fetchDbSetsGrouped(categoryValue: string): Promise<GroupedSets> {
  const config = getCategoryConfig(categoryValue);
  if (!config?.dbSets || !config.dbSetSource) return { en: [], jp: [], other: [] };

  const supabase = getSupabaseClient();
  const result: GroupedSets = { en: [], jp: [], other: [] };

  const extractNames = (data: any[]): string[] => {
    return data
      .map((d: any) => d.set_name)
      .filter((name: any) => name && typeof name === 'string' && name.trim())
      .map((name: string) => name.trim());
  };

  try {
    // Fetch from primary view (e.g. pokemon_sets_en)
    if (config.dbSetSource.view) {
      const { data, error } = await supabase
        .from(config.dbSetSource.view)
        .select('set_name');
      if (!error && data) {
        result.en = Array.from(new Set(extractNames(data))).sort();
      }
    }

    // Fetch from JP view if exists (e.g. pokemon_sets_jp)
    if (config.dbSetSource.viewJp) {
      const { data, error } = await supabase
        .from(config.dbSetSource.viewJp)
        .select('set_name');
      if (!error && data) {
        result.jp = Array.from(new Set(extractNames(data))).sort();
      }
    }

    // Fetch from tcgcsv_products by category_id (One Piece, etc.)
    if (config.dbSetSource.categoryId) {
      const { data, error } = await supabase
        .from('tcgcsv_products')
        .select('set_name')
        .eq('category_id', config.dbSetSource.categoryId)
        .not('set_name', 'is', null)
        .limit(2000);
      if (!error && data) {
        result.other = Array.from(new Set(extractNames(data))).sort();
      }
    }
  } catch (err) {
    console.error('Failed to fetch DB sets for', categoryValue, err);
  }

  return result;
}

/**
 * Seasons for a category, rebuilt on every call.
 *
 * Deliberately not cached in a module-level constant: a server process that
 * stays up across a rollover would keep handing out last season's list, and the
 * start of a season is exactly when a seller reaches for the new label.
 */
export function getSeasons(categoryValue: string): string[] {
  const config = getCategoryConfig(categoryValue);
  if (!config || !config.hasSeasons) return [];
  return config.seasons?.() || [];
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
