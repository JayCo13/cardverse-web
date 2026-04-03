/**
 * Card Catalog — Standardized Sets, Publishers, and Seasons per Category
 *
 * When a seller selects a category, we auto-populate:
 *  - Publisher(s) available for that category
 *  - Sets (dropdown) belonging to the chosen publisher + category
 *  - Seasons (dropdown) — only for categories that use seasons (Soccer, Basketball, F1)
 */

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
// Pokémon
// ────────────────────────────────────────────

const POKEMON_SETS: SetConfig[] = [
  // Scarlet & Violet Era (2023-2025)
  { name: 'Scarlet & Violet - Base Set', code: 'SV01' },
  { name: 'Paldea Evolved', code: 'SV02' },
  { name: 'Obsidian Flames', code: 'SV03' },
  { name: '151', code: 'SV3.5' },
  { name: 'Paradox Rift', code: 'SV04' },
  { name: 'Paldean Fates', code: 'SV4.5' },
  { name: 'Temporal Forces', code: 'SV05' },
  { name: 'Twilight Masquerade', code: 'SV06' },
  { name: 'Shrouded Fable', code: 'SV6.5' },
  { name: 'Stellar Crown', code: 'SV07' },
  { name: 'Surging Sparks', code: 'SV08' },
  { name: 'Prismatic Evolutions', code: 'SV8.5' },
  { name: 'Journey Together', code: 'SV09' },
  { name: 'Destined Rivals', code: 'SV10' },
  // Sword & Shield Era
  { name: 'Sword & Shield - Base Set', code: 'SWSH01' },
  { name: 'Rebel Clash', code: 'SWSH02' },
  { name: 'Darkness Ablaze', code: 'SWSH03' },
  { name: 'Vivid Voltage', code: 'SWSH04' },
  { name: 'Battle Styles', code: 'SWSH05' },
  { name: 'Chilling Reign', code: 'SWSH06' },
  { name: 'Evolving Skies', code: 'SWSH07' },
  { name: 'Fusion Strike', code: 'SWSH08' },
  { name: 'Brilliant Stars', code: 'SWSH09' },
  { name: 'Astral Radiance', code: 'SWSH10' },
  { name: 'Lost Origin', code: 'SWSH11' },
  { name: 'Silver Tempest', code: 'SWSH12' },
  { name: 'Crown Zenith', code: 'SWSH12.5' },
  // Sun & Moon Era
  { name: 'Sun & Moon - Base Set', code: 'SM01' },
  { name: 'Burning Shadows', code: 'SM03' },
  { name: 'Ultra Prism', code: 'SM05' },
  { name: 'Cosmic Eclipse', code: 'SM12' },
  // Classic / XY / BW
  { name: 'XY - Evolutions', code: 'XY12' },
  { name: 'Generations', code: 'GEN' },
  { name: 'Base Set (1999)', code: 'BS' },
  { name: 'Jungle', code: 'JU' },
  { name: 'Fossil', code: 'FO' },
  // Promos & Special
  { name: 'Promo Cards', code: 'PR' },
  { name: 'Trainer Gallery', code: 'TG' },
  { name: 'Khác', code: 'OTHER' },
];

// ────────────────────────────────────────────
// One Piece
// ────────────────────────────────────────────

const ONE_PIECE_SETS: SetConfig[] = [
  { name: 'OP-01 Romance Dawn', code: 'OP01' },
  { name: 'OP-02 Paramount War', code: 'OP02' },
  { name: 'OP-03 Pillars of Strength', code: 'OP03' },
  { name: 'OP-04 Kingdoms of Intrigue', code: 'OP04' },
  { name: 'OP-05 Awakening of the New Era', code: 'OP05' },
  { name: 'OP-06 Wings of the Captain', code: 'OP06' },
  { name: 'OP-07 500 Years in the Future', code: 'OP07' },
  { name: 'OP-08 Two Legends', code: 'OP08' },
  { name: 'OP-09 Emperors in the New World', code: 'OP09' },
  { name: 'OP-10 Royal Blood', code: 'OP10' },
  { name: 'OP-11 A Fist of Divine Speed', code: 'OP11' },
  { name: 'OP-12 Legacy of the Master', code: 'OP12' },
  // Starter Decks
  { name: 'ST-01 Straw Hat Crew', code: 'ST01' },
  { name: 'ST-02 Worst Generation', code: 'ST02' },
  { name: 'ST-03 The Seven Warlords', code: 'ST03' },
  { name: 'ST-04 Animal Kingdom Pirates', code: 'ST04' },
  { name: 'ST-05 ONE PIECE FILM edition', code: 'ST05' },
  // Extra / Premium
  { name: 'Extra Booster -Memorial Collection-', code: 'EB01' },
  { name: 'Premium Booster', code: 'PRB01' },
  { name: 'Promo Cards', code: 'PR' },
  { name: 'Khác', code: 'OTHER' },
];

// ────────────────────────────────────────────
// Soccer / Bóng đá
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
// Basketball / Bóng rổ
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
// Yu-Gi-Oh
// ────────────────────────────────────────────

const YUGIOH_SETS: SetConfig[] = [
  // Recent major sets
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
  // Tins & Special Products
  { name: '25th Anniversary Rarity Collection', code: 'RA02' },
  { name: 'Maximum Gold: El Dorado', code: 'MGED' },
  { name: 'Ghosts From the Past', code: 'GFTP' },
  { name: 'Legendary Duelists Collections' },
  { name: 'Structure Deck' },
  // Classic
  { name: 'Legend of Blue-Eyes White Dragon', code: 'LOB' },
  { name: 'Metal Raiders', code: 'MRD' },
  { name: 'Magic Ruler', code: 'MRL' },
  { name: 'Pharaoh\'s Servant', code: 'PSV' },
  { name: 'Khác', code: 'OTHER' },
];

// ────────────────────────────────────────────
// F1
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
    publishers: [
      { name: 'The Pokémon Company', sets: POKEMON_SETS },
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
    publishers: [
      { name: 'Bandai', sets: ONE_PIECE_SETS },
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

/** Get sets for a category + publisher combo */
export function getSets(categoryValue: string, publisherName?: string): SetConfig[] {
  const config = getCategoryConfig(categoryValue);
  if (!config) return [];

  if (publisherName) {
    const pub = config.publishers.find(p => p.name === publisherName);
    return pub ? pub.sets : [];
  }

  // If only one publisher, return its sets
  if (config.publishers.length === 1) {
    return config.publishers[0].sets;
  }

  // Merge all publishers' sets
  return config.publishers.flatMap(p => p.sets);
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
