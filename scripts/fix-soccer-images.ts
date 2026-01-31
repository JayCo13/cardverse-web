#!/usr/bin/env npx ts-node
/**
 * Fix Soccer Card Images - Updates image_url from metadata thumbnailImages
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration - load from environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixSoccerImages() {
    console.log('🔧 Fixing soccer card images...\n');

    // Fetch cards with broken images or low-res images
    const { data: cards, error } = await supabase
        .from('crawled_cards')
        .select('id, image_url, metadata')
        .or('image_url.eq.UPDATED,image_url.like.%s-l225%')
        .limit(500);

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    console.log(`Found ${cards?.length || 0} cards to fix`);

    let fixed = 0;
    for (const card of cards || []) {
        // Try to get high-res URL from metadata
        let newUrl: string | null = null;

        if (card.metadata?.thumbnailImages?.[0]?.imageUrl) {
            newUrl = card.metadata.thumbnailImages[0].imageUrl;
        } else if (card.metadata?.image?.imageUrl) {
            // Convert from s-l225 to s-l1600
            newUrl = card.metadata.image.imageUrl
                .replace(/s-l\d+\.jpg/i, 's-l1600.jpg')
                .replace(/s-l\d+\.png/i, 's-l1600.png')
                .replace(/s-l\d+\.webp/i, 's-l1600.webp');
        }

        if (newUrl && newUrl !== card.image_url) {
            const { error: updateError } = await supabase
                .from('crawled_cards')
                .update({ image_url: newUrl })
                .eq('id', card.id);

            if (!updateError) {
                fixed++;
                console.log(`✅ Fixed: ${card.id.slice(0, 8)}...`);
            }
        }
    }

    console.log(`\n🎉 Fixed ${fixed} cards`);
}

fixSoccerImages();
