#!/usr/bin/env npx ts-node
/**
 * Soccer & Football Card Crawler (Web Scraper Version)
 * Fetches sold cards from eBay (2025-2026) by scraping search results.
 * 
 * Usage: npx ts-node scripts/crawl-soccer-football.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import axios from 'axios';
import 'dotenv/config';

// Configuration - load from environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SELLER_ID = process.env.SELLER_ID || 'bbf79ca5-b980-4fdd-85a6-31cac47db0c4';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

// ========================================
// SOCCER SETS 2025/2026 ONLY
// ========================================
const SOCCER_SETS = [
    // ===== TOPPS 2025 =====
    { name: 'Topps Chrome 2025', query: 'topps chrome soccer 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Topps Chrome 2025 Refractor', query: 'topps chrome soccer 2025 refractor -pack -box', minPrice: 8 },
    { name: 'Topps Chrome 2025 Auto', query: 'topps chrome soccer 2025 autograph -pack -box', minPrice: 15 },
    { name: 'Topps Finest 2025', query: 'topps finest soccer 2025 card -pack -box -lot', minPrice: 5 },
    { name: 'Topps Merlin 2025', query: 'topps merlin soccer 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Topps UCL 2025', query: 'topps champions league 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Topps Museum 2025', query: 'topps museum collection soccer 2025 card -pack -box -lot', minPrice: 10 },
    { name: 'Topps Deco 2025', query: 'topps deco soccer 2025 card -pack -box -lot', minPrice: 5 },
    { name: 'Topps Flagship 2025', query: 'topps flagship soccer 2025 card -pack -box -lot', minPrice: 3 },

    // ===== TOPPS 2026 =====
    { name: 'Topps Chrome 2026', query: 'topps chrome soccer 2026 card -pack -box -lot', minPrice: 3 },
    { name: 'Topps 2026', query: 'topps soccer 2026 card -pack -box -lot -sticker', minPrice: 3 },
    { name: 'Topps Museum 2026', query: 'topps museum collection soccer 2026 card -pack -box -lot', minPrice: 10 },
    { name: 'Topps Deco 2026', query: 'topps deco soccer 2026 card -pack -box -lot', minPrice: 5 },
    { name: 'Topps Flagship 2026', query: 'topps flagship soccer 2026 card -pack -box -lot', minPrice: 3 },

    // ===== PANINI 2025 =====
    { name: 'Panini Prizm 2025', query: 'panini prizm soccer 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini Prizm 2025 Silver', query: 'panini prizm soccer 2025 silver -pack -box', minPrice: 8 },
    { name: 'Panini Prizm 2025 Color', query: 'panini prizm soccer 2025 gold blue red -pack -box', minPrice: 15 },
    { name: 'Panini Select 2025', query: 'panini select soccer 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini Mosaic 2025', query: 'panini mosaic soccer 2025 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini Donruss 2025', query: 'panini donruss soccer 2025 card -pack -box -lot', minPrice: 2 },

    // ===== PANINI 2026 =====
    { name: 'Panini Prizm 2026', query: 'panini prizm soccer 2026 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini 2026', query: 'panini soccer 2026 card -pack -box -lot -sticker', minPrice: 3 },

    // ===== 2025/2026 GENERAL =====
    { name: 'Soccer Cards 2025', query: 'soccer card 2025 -pack -box -lot -sticker -bundle', minPrice: 2 },
    { name: 'Soccer Cards 2026', query: 'soccer card 2026 -pack -box -lot -sticker -bundle', minPrice: 2 },
    { name: 'Soccer Auto 2025', query: 'soccer autograph 2025 card -pack -box -lot', minPrice: 10 },
    { name: 'Soccer Numbered 2025', query: 'soccer card 2025 /99 /50 /25 numbered -pack -box', minPrice: 10 },
    { name: 'Soccer Insert 2025', query: 'soccer card 2025 insert -pack -box -lot', minPrice: 5 },
];

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ParsedItem {
    itemId: string;
    title: string;
    price: number;
    imageUrl: string;
    itemUrl: string;
}

interface CrawledCard {
    name: string;
    price: number;
    category: string;
    listing_type: string;
    seller_id: string;
    ebay_id: string;
    description: string;
    image_url: string | null;
    year: string | null;
    grader: string | null;
    grade: string | null;
    set_name: string | null;
    player_name: string | null;
    metadata: Record<string, unknown>;
}

async function scrapeEbay(query: string, minPrice: number, page: number = 1): Promise<ParsedItem[]> {
    const encodedQuery = encodeURIComponent(query);
    // eBay search URL pattern: _nkw=query, _sacat=0 (all categories), _from=R40, _pgn=page
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sacat=0&_from=R40&_pgn=${page}&rt=nc`;

    console.log(`🔍 Scraping: ${query.substring(0, 40)}... (Page: ${page})`);

    try {
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        const $ = cheerio.load(html);
        const items: ParsedItem[] = [];

        $('.s-item').each((_, element) => {
            const title = $(element).find('.s-item__title').text().trim();
            // Skip "Shop on eBay" pseudo-items
            if (title.toUpperCase().includes('SHOP ON EBAY')) return;

            const priceText = $(element).find('.s-item__price').text().trim();
            const rawPrice = parseFloat(priceText.replace(/[^0-9.]/g, ''));

            // Skip items below minPrice
            if (isNaN(rawPrice) || rawPrice < minPrice) return;

            const imageImg = $(element).find('.s-item__image-img');
            let imageUrl = imageImg.attr('src') || imageImg.attr('data-src') || '';

            // Try to get high-res image from data-src or optimize existing
            if (imageUrl) {
                // Convert s-l225 to s-l1600 if possible, roughly
                imageUrl = imageUrl.replace(/s-l\d+\./, 's-l1600.');
            }

            const link = $(element).find('.s-item__link').attr('href') || '';
            // Extract Item ID from URL (usually after /itm/)
            const itemIdMatch = link.match(/\/itm\/(\d+)/);
            const itemId = itemIdMatch ? itemIdMatch[1] : '';

            if (itemId && title && rawPrice > 0 && imageUrl) {
                items.push({
                    itemId,
                    title,
                    price: rawPrice,
                    imageUrl,
                    itemUrl: link
                });
            }
        });

        return items;

    } catch (error) {
        console.error(`❌ Scraping failed: ${(error as any).message}`);
        return [];
    }
}

function parseCardDetails(title: string): { year: string | null; grader: string | null; grade: string | null; setName: string | null; playerName: string | null } {
    // Extract year
    const yearMatch = title.match(/\b(202[0-6]|201\d)\b/);
    const year = yearMatch ? yearMatch[0] : null;

    // Extract grader
    const graderMatch = title.match(/\b(PSA|BGS|SGC|CGC|TAG|ACE)\b/i);
    const grader = graderMatch ? graderMatch[0].toUpperCase() : null;

    // Extract grade
    let grade: string | null = null;
    if (grader) {
        const gradeRegex = new RegExp(`${grader}\\s?(\\d{1,2}(\\.\\d)?)`, 'i');
        const gradeMatch = title.match(gradeRegex);
        if (gradeMatch) grade = gradeMatch[1];
    }

    // Extract set name
    const setMatch = title.match(/\b(Prizm|Chrome|Finest|Optic|Select|Mosaic|Hoops|Donruss|Bowman|Topps|Panini|Upper Deck|Fleer|Score)\b/i);
    const setName = setMatch ? setMatch[0] : null;

    // Extract player name
    const playerPatterns = [
        /\b(Mbappe|Mbappé|Haaland|Bellingham|Yamal|Mainoo|Wirtz|Musiala)\b/i,
        /\b(Messi|Ronaldo|Neymar)\b/i,
        /\b(Salah|Saka|Palmer|Foden|Rice|Bruno Fernandes|Fernandes|Rashford|Kane)\b/i,
        /\b(Vinicius|Vini Jr|Pedri|Gavi|Lautaro|Martinez)\b/i,
        /\b(Sane|Gnabry|Havertz)\b/i,
        /\b(De Bruyne|Modric|Kroos|Lewandowski)\b/i
    ];
    let playerName: string | null = null;
    for (const pattern of playerPatterns) {
        const match = title.match(pattern);
        if (match) {
            playerName = match[0];
            break;
        }
    }

    return { year, grader, grade, setName, playerName };
}

function formatCard(item: ParsedItem, category: string, sport: string): CrawledCard | null {
    const title = item.title.toLowerCase();

    // Exclude unwanted items
    const excludePatterns = [
        'mystery', 'pack', 'box', 'lot', 'bundle', 'set of', 'collection', 'bulk', 'repack',
        'break', 'pick your', 'you pick', 'choose', 'complete set', 'base set', 'hobby', 'blaster',
        'mega box', 'hanger', 'cello', 'fat pack', 'value pack', 'multi pack', 'guaranteed', 'random',
        'chase', 'hit or miss', 'sticker', 'album', 'digital', 'online', 'code', 'printing plate'
    ];

    for (const pattern of excludePatterns) {
        if (title.includes(pattern)) return null;
    }

    const { year, grader, grade, setName, playerName } = parseCardDetails(item.title);

    return {
        name: item.title,
        price: item.price,
        category: `${sport.charAt(0).toUpperCase() + sport.slice(1)} Cards`,
        listing_type: 'sale',
        seller_id: SELLER_ID,
        ebay_id: item.itemId,
        description: `eBay Item ID: ${item.itemId} | Source: ${item.itemUrl}`,
        image_url: item.imageUrl,
        year,
        grader,
        grade,
        set_name: setName,
        player_name: playerName,
        metadata: {
            sport,
            original_price_usd: item.price,
            crawled_at: new Date().toISOString(),
            source_url: item.itemUrl
        }
    };
}

async function insertCards(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    console.log(`💾 Inserting ${cards.length} cards into database...`);

    const ebayIds = cards.map(c => c.ebay_id);
    const { data: existingCards } = await supabase
        .from('crawled_cards')
        .select('ebay_id')
        .in('ebay_id', ebayIds);

    const existingIds = new Set(existingCards?.map(c => c.ebay_id) || []);
    const newCards = cards.filter(c => !existingIds.has(c.ebay_id));

    if (newCards.length === 0) {
        console.log('ℹ️  All cards already exist in database');
        return 0;
    }

    const { error } = await supabase
        .from('crawled_cards')
        .insert(newCards);

    if (error) {
        console.error('❌ Insert error:', error.message);
        return 0;
    }

    console.log(`✅ Inserted ${newCards.length} new cards`);
    return newCards.length;
}

async function main() {
    console.log('🚀 Starting Soccer 2025/2026 Set Crawler (Scraper Mode)...\n');

    try {
        let totalInserted = 0;

        for (const set of SOCCER_SETS) {
            console.log(`\n🏆 ${set.name}`);

            let setInserted = 0;
            // Scrape up to 2 pages
            for (let page = 1; page <= 2; page++) {

                try {
                    const items = await scrapeEbay(set.query, set.minPrice, page);
                    if (items.length === 0) break;

                    const cards = items
                        .map(item => formatCard(item, set.name, 'soccer'))
                        .filter((card): card is CrawledCard => card !== null);

                    const inserted = await insertCards(cards);
                    setInserted += inserted;
                    totalInserted += inserted;

                    if (items.length < 20) break; // Use simplified check

                    // Random delay to behave like a human (2-5 seconds)
                    const delay = Math.floor(Math.random() * 3000) + 2000;
                    await new Promise(resolve => setTimeout(resolve, delay));

                } catch (e) {
                    console.error(`   Error on page ${page}:`, e);
                    break;
                }
            }
            console.log(`   ✨ Total new for set: ${setInserted}`);

            // Delay between sets
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        console.log(`\n🎉 Complete! Total new cards: ${totalInserted}`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
