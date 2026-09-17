/**
 * Card Catalog — Category configuration & DB-driven set fetching
 *
 * Sets for Pokemon, One Piece and Yu-Gi-Oh come from `tcgcsv_groups` in
 * Supabase (one row per TCGplayer set, kept current by the TCGCSV crawlers).
 * For other categories (Soccer, Basketball, F1), we use curated static lists.
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
    /**
     * TCGplayer category ids whose `tcgcsv_groups` rows are this category's
     * sets, keyed by the picker heading they appear under.
     */
    groups: { en?: number; jp?: number; other?: number };
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

/**
 * One entry per product line × licence, with no year: the season field carries
 * that. Sub-lines sold as their own product (Chrome Sapphire, Merlin Chrome,
 * Adrenalyn XL per league…) get their own entry because that is the name on
 * the box a seller is reading from.
 *
 * Compiled 2026-09 from release archives (collectosk, Checklist Insider,
 * BreakNinja) and the Leaf / Futera catalogues. Topps and Panini entries drop
 * the maker's name; Leaf and Futera keep it, as their products are sold that
 * way. Names already used by live listings must stay spelled as they are.
 */
const SOCCER_PANINI_SETS: SetConfig[] = [
  // Prizm / Select / Mosaic
  { name: 'Prizm FIFA World Cup' },
  { name: 'Prizm FIFA' },
  { name: 'Prizm FIFA Club World Cup' },
  { name: 'Prizm CONMEBOL Copa América' },
  { name: 'Prizm Premier League' },
  { name: 'Prizm K League' },
  { name: 'Prizm Monopoly FIFA World Cup' },
  { name: 'Prizm Sticker FIFA World Cup' },
  { name: 'Select FIFA' },
  { name: 'Select Road to FIFA World Cup' },
  { name: 'Select UEFA Euro' },
  { name: 'Select Premier League' },
  { name: 'Select La Liga' },
  { name: 'Select Serie A' },
  { name: 'Select Ligue 1' },
  { name: 'Mosaic FIFA World Cup' },
  { name: 'Mosaic Road to FIFA World Cup' },
  { name: 'Mosaic UEFA Euro' },
  { name: 'Mosaic Premier League' },
  { name: 'Mosaic La Liga' },
  { name: 'Mosaic Serie A' },
  // Donruss / Score / Chronicles
  { name: 'Donruss Soccer' },
  { name: 'Donruss FIFA' },
  { name: 'Donruss Road to FIFA World Cup' },
  { name: 'Donruss Elite FIFA' },
  { name: 'Donruss Elite Premier League' },
  { name: 'Donruss Elite La Liga' },
  { name: 'Donruss Elite Serie A' },
  { name: "Donruss FIFA Women's World Cup" },
  { name: 'Donruss NWSL' },
  { name: 'Donruss Optic NWSL' },
  { name: 'Score FIFA' },
  { name: 'Score Premier League' },
  { name: 'Score La Liga' },
  { name: 'Score Serie A' },
  { name: 'Score Ligue 1' },
  { name: 'Chronicles Soccer' },
  // Premium / hobby
  { name: 'Immaculate Soccer' },
  { name: 'National Treasures Soccer' },
  { name: 'National Treasures Road to FIFA World Cup' },
  { name: 'Flawless Soccer' },
  { name: 'Flawless FIFA World Cup' },
  { name: 'Eminence FIFA World Cup' },
  { name: 'Noir Soccer' },
  { name: 'Noir Road to FIFA World Cup' },
  { name: 'Obsidian Soccer' },
  { name: 'Obsidian K League' },
  { name: 'Impeccable Premier League' },
  { name: 'Revolution Premier League' },
  { name: 'Revolution K League' },
  { name: 'Absolute K League' },
  { name: 'Gold Standard Soccer' },
  { name: 'Nobility Soccer' },
  { name: 'Aficionado Soccer' },
  { name: 'Treble Soccer' },
  { name: 'Pitch Kings La Liga' },
  { name: 'Prestige EFL' },
  { name: "Panini's Football EFL" },
  { name: 'Eternity EFL' },
  { name: "Eternity Women's Super League" },
  { name: 'Eternity Bleus' },
  { name: 'Eternity Lionesses' },
  { name: 'Eternity Olympiens' },
  { name: 'Luminance England' },
  { name: 'Luminance France' },
  { name: 'Luminance Germany' },
  { name: 'INTL England' },
  { name: 'INTL France' },
  { name: 'INTL Germany' },
  { name: 'INTL Mexico' },
  { name: 'Podium FC Barcelona' },
  { name: 'Podium Real Madrid' },
  { name: 'Tributo Real Madrid' },
  { name: 'Crown Royale NWSL' },
  { name: 'Frauen Bundesliga' },
  { name: 'DFB Team Set' },
  { name: 'The Best of England' },
  { name: 'US Soccer Box Set' },
  { name: 'Instant' },
  { name: 'Player of the Day' },
  // Sticker / Adrenalyn XL / Top Class
  { name: 'Sticker Album FIFA World Cup' },
  { name: 'Sticker Album UEFA Euro' },
  { name: 'Sticker Album Road to FIFA World Cup' },
  { name: 'Sticker Album Premier League' },
  { name: 'Sticker Album La Liga' },
  { name: 'Sticker Album Calciatori Serie A' },
  { name: 'Sticker Album UEFA Champions League' },
  { name: 'Sticker Album Copa América' },
  { name: 'Sticker Album FIFA 365' },
  { name: 'Adrenalyn XL UEFA Champions League' },
  { name: 'Adrenalyn XL Premier League' },
  { name: 'Adrenalyn XL La Liga' },
  { name: 'Adrenalyn XL Serie A' },
  { name: 'Adrenalyn XL Ligue 1' },
  { name: 'Adrenalyn XL Bundesliga' },
  { name: 'Adrenalyn XL FIFA World Cup' },
  { name: 'Adrenalyn XL UEFA Euro' },
  { name: 'Adrenalyn XL Copa América' },
  { name: 'Adrenalyn XL FIFA 365' },
  { name: 'Megacracks La Liga' },
  { name: 'FIFA Top Class' },
  { name: 'Premier League Top Class' },
  { name: 'Top Class' },
  { name: 'Khác' },
];

const SOCCER_TOPPS_SETS: SetConfig[] = [
  // UEFA Club Competitions (2023-24 onwards)
  { name: 'UEFA Club Competitions' },
  { name: 'Chrome UEFA Club Competitions' },
  { name: 'Chrome Sapphire UEFA Club Competitions' },
  { name: 'Chrome Logofractor UEFA Club Competitions' },
  { name: 'Finest UEFA Club Competitions' },
  { name: 'Finest Flashbacks UEFA Club Competitions' },
  { name: 'Museum Collection UEFA Club Competitions' },
  { name: 'Merlin Chrome UEFA Club Competitions' },
  { name: 'Merlin Heritage UEFA' },
  { name: 'Stadium Club Chrome UEFA Club Competitions' },
  { name: 'Inception UEFA Club Competitions' },
  { name: 'Deco UEFA Club Competitions' },
  { name: 'Gold UEFA Club Competitions' },
  { name: 'Simplicidad UEFA Club Competitions' },
  { name: 'Superstars UEFA Club Competitions' },
  { name: 'Definitive Collection UEFA Club Competitions' },
  { name: 'Reverence UEFA Club Competitions' },
  { name: 'Impact UEFA Club Competitions' },
  { name: 'Jade Edition UEFA Club Competitions' },
  { name: 'Japan Edition UEFA Club Competitions' },
  { name: 'Jogaço UEFA Club Competitions' },
  { name: 'Carnaval UEFA Club Competitions' },
  { name: 'Decades 1990s Edition UEFA Club Competitions' },
  { name: '1st Edition UEFA Club Competitions' },
  { name: 'Knockout UEFA Club Competitions' },
  { name: 'Summer Signings UEFA Club Competitions' },
  { name: 'Living Set UEFA Club Competitions' },
  { name: 'Platinum Curated Set UEFA Club Competitions' },
  { name: 'Match Attax UEFA Club Competitions' },
  { name: 'UEFA Club Competitions Stickers' },
  // UEFA Champions League (up to 2022-23)
  { name: 'UEFA Champions League' },
  { name: 'Chrome UEFA Champions League' },
  { name: 'Chrome Sapphire UEFA Champions League' },
  { name: 'Finest UEFA Champions League' },
  { name: 'Finest Flashbacks UEFA Champions League' },
  { name: 'Museum Collection UEFA Champions League' },
  { name: 'Merlin Chrome UEFA Champions League' },
  { name: 'Stadium Club Chrome UEFA Champions League' },
  { name: 'Inception UEFA Champions League' },
  { name: 'Deco UEFA Champions League' },
  { name: 'Gold UEFA Champions League' },
  { name: 'Simplicidad UEFA Champions League' },
  { name: 'Dynasty UEFA Champions League' },
  { name: 'Pearl UEFA Champions League' },
  { name: 'Crystal Premium UEFA Champions League' },
  { name: 'Knockout UEFA Champions League' },
  { name: 'Match Attax UEFA Champions League' },
  { name: 'Match Attax Chrome UEFA Champions League' },
  { name: 'Match Attax Fire UEFA Champions League' },
  { name: 'Best of the Best UEFA Champions League' },
  { name: 'O Jogo Bonito UEFA Champions League' },
  { name: 'Football Festival by Steve Aoki UEFA Champions League' },
  { name: 'The Lost Rookies UEFA Champions League' },
  { name: 'Summer Signings UEFA Champions League' },
  { name: 'Curated Set UEFA Champions League' },
  { name: 'UEFA Champions League 30 Seasons Celebration' },
  { name: 'UEFA Champions League Final' },
  { name: 'UEFA Champions League Stickers' },
  { name: 'Now UEFA Champions League' },
  { name: 'Now UEFA Europa League' },
  // UEFA Women's / Euro / national teams
  { name: "Chrome UEFA Women's Champions League" },
  { name: "Chrome Sapphire UEFA Women's Champions League" },
  { name: "Knockout UEFA Women's Champions League" },
  { name: "Now UEFA Women's Champions League" },
  { name: "Merlin UEFA Women's Euro" },
  { name: 'Chrome UEFA Euro' },
  { name: 'Chrome Sapphire UEFA Euro' },
  { name: 'Finest Road to UEFA Euro' },
  { name: 'Pristine Road to UEFA Euro' },
  { name: 'Match Attax UEFA Euro' },
  { name: 'UEFA Euro Stickers' },
  { name: 'Chrome Road to UEFA Nations League Finals' },
  { name: 'Bowman Chrome Road to UEFA Under-21 Championship' },
  { name: 'Argentina Official Team Set' },
  { name: 'Argentina World Champions' },
  { name: 'Argentina Fileteado' },
  { name: 'Lineage Argentina' },
  { name: 'Focus Argentina' },
  { name: 'Polska Official Fan Set' },
  // Premier League
  { name: 'Premier League' },
  { name: 'Chrome Premier League' },
  { name: 'Chrome Sapphire Premier League' },
  { name: 'Chrome Logofractor Premier League' },
  { name: 'Finest Premier League' },
  { name: 'Merlin Premier League' },
  { name: 'Pristine Premier League' },
  { name: 'Gold Premier League' },
  { name: 'Royalty Premier League' },
  { name: 'Decades 1990s Edition Premier League' },
  { name: 'Match Attax Premier League' },
  { name: 'Match Attax Extra Premier League' },
  { name: 'Merlin Premier League Stickers' },
  { name: 'Premier Gold' },
  { name: 'Premier Club' },
  { name: 'Premier League Platinum' },
  // Bundesliga
  { name: 'Bundesliga' },
  { name: 'Chrome Bundesliga' },
  { name: 'Chrome Sapphire Bundesliga' },
  { name: 'Finest Bundesliga' },
  { name: 'Inception Bundesliga' },
  { name: 'Stadium Club Chrome Bundesliga' },
  { name: 'Gold Bundesliga' },
  { name: 'Midnight Bundesliga' },
  { name: 'Tier One Bundesliga' },
  { name: 'Jade Edition Bundesliga' },
  { name: 'Match Attax Bundesliga' },
  { name: 'Match Attax Chrome Bundesliga' },
  { name: 'Match Attax Heroes Bundesliga' },
  { name: 'Bundesliga Stars of the Season' },
  { name: 'Bundesliga International Stars' },
  { name: 'Bundesliga Summer Signings' },
  { name: 'Bundesliga 60 Years Celebration' },
  { name: 'Bundesliga Japan Edition' },
  { name: 'Bundesliga Stickers' },
  { name: 'Now Bundesliga' },
  { name: 'Platinum Curated Set Bundesliga' },
  // MLS
  { name: 'MLS' },
  { name: 'Chrome MLS' },
  { name: 'Chrome Sapphire MLS' },
  { name: 'Finest MLS' },
  { name: 'Inception MLS' },
  { name: 'Superstars MLS' },
  { name: 'MLS 30th Anniversary Collection' },
  // Club releases
  { name: 'Official Team Set' },
  { name: 'Official Fan Set' },
  { name: 'Chrome FC Barcelona' },
  { name: 'Chrome FC Bayern München' },
  { name: 'Chrome Borussia Dortmund' },
  { name: 'Chrome Liverpool FC' },
  { name: 'Chrome Juventus' },
  { name: 'Chrome Arsenal' },
  { name: 'Chrome Atlético de Madrid' },
  { name: 'Chrome RB Leipzig' },
  { name: 'Chrome FC Red Bull Salzburg' },
  { name: 'Chrome Deluxe Edition Manchester United' },
  { name: 'Palatial Liverpool FC' },
  { name: 'Palatial Manchester United' },
  { name: 'Palatial Real Madrid CF' },
  { name: 'Lineage FC Bayern München' },
  { name: 'Lineage Chelsea FC' },
  { name: 'Focus FC Barcelona' },
  { name: 'Focus Borussia Dortmund' },
  { name: 'Focus Liverpool FC' },
  { name: 'Forever FC Barcelona' },
  { name: 'Forever FC Bayern München' },
  { name: 'Forever Arsenal' },
  { name: 'Forever Manchester City' },
  { name: 'Winners Collection Arsenal' },
  { name: 'Winners Collection Paris Saint-Germain' },
  { name: 'Exhibition Paris Saint-Germain' },
  { name: 'Premium Paris Saint-Germain' },
  { name: 'Premium Borussia Dortmund' },
  { name: 'Vernissage Borussia Dortmund' },
  { name: 'Los Blancos Real Madrid CF' },
  { name: 'Blue Moon Manchester City' },
  { name: 'Triplete FC Barcelona' },
  { name: 'FC Barcelona 125 Years Anniversary' },
  { name: 'FC Bayern München 125 Years Anniversary' },
  { name: 'AFC Ajax 125th Anniversary' },
  { name: 'AC Milan 125 Anniversario' },
  { name: "Paris Saint-Germain Champions d'Europe" },
  { name: 'Project 22' },
  { name: 'Khác' },
];

const SOCCER_LEAF_SETS: SetConfig[] = [
  { name: 'Leaf Metal Soccer' },
  { name: 'Leaf Metal Soccer Stars' },
  { name: 'Leaf Ultimate' },
  { name: 'Leaf Trinity' },
  { name: 'Leaf Vivid Soccer' },
  { name: 'Leaf Signature Series Soccer' },
  { name: 'Leaf Continuum Soccer' },
  { name: 'Leaf Goal Soccer' },
  { name: 'Leaf Glory of the Game Soccer' },
  { name: 'Leaf Electrum Soccer' },
  { name: 'Leaf Immortal Collection Soccer' },
  { name: 'Leaf Autographed Soccer Jersey Edition' },
  { name: 'Leaf Soccer Blaster' },
  { name: 'Leaf Best of Soccer' },
  { name: 'Pro Set Soccer' },
  { name: 'Pro Set Metal Soccer' },
  { name: 'Khác' },
];

const SOCCER_FUTERA_SETS: SetConfig[] = [
  // Modern (2005 onwards)
  { name: 'Futera Unique' },
  { name: 'Futera Unique Live' },
  { name: 'Futera Unique FC Barcelona' },
  { name: 'Futera Unique Liverpool FC' },
  { name: 'Futera Unique Arsenal' },
  { name: 'Futera Unique Manchester City' },
  { name: 'Futera Unique Paris Saint-Germain' },
  { name: 'Futera Unique Olympique de Marseille' },
  { name: 'Futera Unique Borussia Mönchengladbach' },
  { name: 'Futera Unique Wolverhampton Wanderers' },
  { name: 'Futera World Football FX' },
  { name: 'Futera FX Club Edition' },
  { name: 'Futera World Football Platinum' },
  { name: 'Futera Platinum Club Edition' },
  { name: 'Futera Fans Selection World Football' },
  { name: 'Futera Fans Selection Club Edition' },
  { name: 'Futera Club Live' },
  { name: 'Futera Incredible' },
  { name: 'Futera Headliners' },
  { name: 'Futera Goal' },
  { name: 'Futera Season Review' },
  { name: 'Futera Prominent Sets' },
  { name: 'Futera World Football Online' },
  { name: 'Futera World Stars Foil Pack' },
  // Vintage (1994-2001)
  { name: 'Futera Platinum' },
  { name: 'Futera Fans Selection' },
  { name: 'Futera Manchester United' },
  { name: 'Futera World Cup Greats Platinum' },
  { name: 'Futera NSL Soccer' },
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
  // Prizm / Select / Mosaic / Donruss
  { name: 'Prizm NBA' },
  { name: 'Prizm Draft Picks' },
  { name: 'Prizm Black' },
  { name: 'Prizm Deca' },
  { name: 'Prizm Monopoly' },
  { name: 'Prizm Premium Factory Set' },
  { name: 'Select NBA' },
  { name: 'Select Draft Picks' },
  { name: 'Mosaic NBA' },
  { name: 'Donruss NBA' },
  { name: 'Donruss Optic' },
  { name: 'Donruss Elite' },
  // Hoops / Court Kings / Contenders / Chronicles
  { name: 'Hoops NBA' },
  { name: 'Hoops Premium Stock' },
  { name: 'Court Kings NBA' },
  { name: 'Contenders NBA' },
  { name: 'Contenders Optic' },
  { name: 'Crown Royale' },
  { name: 'Chronicles NBA' },
  { name: 'Chronicles Draft Picks' },
  { name: 'Revolution NBA' },
  { name: 'Obsidian NBA' },
  { name: 'Origins NBA' },
  { name: 'Spectra NBA' },
  { name: 'Phoenix' },
  { name: 'Photogenic' },
  { name: 'Recon' },
  { name: 'Illusions' },
  { name: 'Absolute' },
  { name: 'Certified' },
  { name: 'Status' },
  { name: 'Threads' },
  { name: 'Encased' },
  { name: 'Totally Certified' },
  { name: 'Silhouette' },
  { name: 'Signature Series' },
  { name: 'One and One' },
  { name: 'Black' },
  { name: 'Haunted Hoops' },
  // Premium
  { name: 'Noir' },
  { name: 'Eminence' },
  { name: 'Impeccable' },
  { name: 'Immaculate NBA' },
  { name: 'National Treasures NBA' },
  { name: 'Flawless' },
  // Stickers / on-demand
  { name: 'NBA Sticker & Card Collection' },
  { name: 'NBA Top Class' },
  { name: 'Instant' },
  { name: 'Khác' },
];

const BASKETBALL_TOPPS_SETS: SetConfig[] = [
  // NBA (Topps holds the licence from 2025-26)
  { name: 'Basketball' },
  { name: 'Chrome Basketball' },
  { name: 'Chrome Black Basketball' },
  { name: 'Chrome Sapphire Basketball' },
  { name: 'Chrome Update Series Basketball' },
  { name: 'Chrome Update Sapphire Basketball' },
  { name: 'Cosmic Chrome Basketball' },
  { name: 'Finest Basketball' },
  { name: 'Inception Basketball' },
  { name: 'Midnight Basketball' },
  { name: 'Motif Basketball' },
  { name: 'Pristine Basketball' },
  { name: 'Royalty Basketball' },
  { name: 'Definitive Collection Basketball' },
  { name: 'Signature Class Basketball' },
  { name: 'Holiday Basketball' },
  { name: 'Topps 3 Basketball' },
  { name: 'Chrome Cactus Jack Basketball' },
  { name: 'Now Basketball' },
  // Other leagues / draft
  { name: 'Chrome OTE Basketball' },
  { name: 'Chrome NBL Basketball' },
  { name: 'NBL Basketball' },
  { name: 'G League Basketball' },
  { name: "Chrome McDonald's All American" },
  { name: 'Bowman Basketball' },
  { name: 'Bowman Sapphire Basketball' },
  { name: 'Bowman University Chrome' },
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
// F1 — Static sets
// ────────────────────────────────────────────

const F1_TOPPS_SETS: SetConfig[] = [
  { name: 'Formula 1' },
  { name: 'Chrome Formula 1' },
  { name: 'Chrome Sapphire Formula 1' },
  { name: 'Chrome Logofractor Formula 1' },
  { name: 'Finest Formula 1' },
  { name: 'Dynasty Formula 1' },
  { name: 'Eccellenza Formula 1' },
  { name: 'Lights Out Formula 1' },
  { name: 'Paddock Pass Formula 1' },
  { name: 'Turbo Attax Formula 1' },
  { name: 'Turbo Attax Fire Formula 1' },
  { name: 'Now Formula 1' },
  { name: 'Formula 1 Stickers' },
  { name: 'Fanatics Fest Formula 1' },
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
    dbSetSource: { groups: { en: 3, jp: 85 } },
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
      { name: 'Topps', sets: BASKETBALL_TOPPS_SETS },
    ],
  },
  {
    label: 'One Piece',
    labelEn: 'One Piece',
    value: 'One Piece',
    hasSeasons: false,
    dbSets: true,
    dbSetSource: { groups: { other: 68 } },
    publishers: [
      { name: 'Bandai', sets: [] }, // sets loaded from DB
    ],
  },
  {
    label: 'Yu-Gi-Oh',
    labelEn: 'Yu-Gi-Oh',
    value: 'Yu-Gi-Oh',
    hasSeasons: false,
    dbSets: true,
    dbSetSource: { groups: { other: 2 } },
    publishers: [
      { name: 'Konami', sets: [] }, // sets loaded from DB
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
 * Fetch sets from the database for DB-driven categories (Pokemon, One Piece, Yu-Gi-Oh).
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
 * For Pokemon: EN = tcgcsv_groups category 3, JP = tcgcsv_groups category 85
 * For One Piece (68) and Yu-Gi-Oh (2): all sets go into "other"
 *
 * Reads the group (set) table rather than deriving sets from the products
 * (the `pokemon_sets_*` views, or a distinct on `tcgcsv_products.set_name`):
 * a set only gets into those once its cards are synced, and the Pokemon views
 * further require a collector number, so a set whose cards have none on
 * TCGplayer (most pre-2010 JP sets, and any set listed before its cards are)
 * never appeared, and a seller holding one of those cards had nothing to
 * pick. Group names are what `set_name` holds on the products, so existing
 * listings still match.
 */
export async function fetchDbSetsGrouped(categoryValue: string): Promise<GroupedSets> {
  const config = getCategoryConfig(categoryValue);
  if (!config?.dbSets || !config.dbSetSource) return { en: [], jp: [], other: [] };

  const supabase = getSupabaseClient();
  const result: GroupedSets = { en: [], jp: [], other: [] };

  const fetchGroupNames = async (categoryId: number): Promise<string[]> => {
    const { data, error } = await supabase
      .from('tcgcsv_groups')
      .select('name')
      .eq('category_id', categoryId)
      .limit(2000);
    if (error || !data) return [];
    const names = data
      .map((d: any) => d.name)
      .filter((name: any) => name && typeof name === 'string' && name.trim())
      .map((name: string) => name.trim());
    return Array.from(new Set(names)).sort();
  };

  try {
    const { en, jp, other } = config.dbSetSource.groups;
    if (en) result.en = await fetchGroupNames(en);
    if (jp) result.jp = await fetchGroupNames(jp);
    if (other) result.other = await fetchGroupNames(other);
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
