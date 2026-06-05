-- =====================================================================
-- Upgrade low-res card images to high-res.
--
-- TCGplayer serves a thumbnail "..._200w.jpg" (and other _<N>w.jpg sizes)
-- that looks broken/blurry when displayed large. The high-res variant is
-- "..._in_1000x1000.jpg". The crawler now stores the high-res URL; this
-- rewrites the rows already crawled.
--
-- Safe: only rows whose image_url ends in "_<digits>w.jpg" are touched
-- (already-high-res URLs and other sources don't match). Run in the
-- Supabase SQL Editor.
-- =====================================================================

-- 1) PREVIEW — how many rows still use a low-res thumbnail.
select count(*) as low_res_rows
from tcgcsv_products
where image_url ~ '_[0-9]+w\.jpg$';

-- 2) Rewrite to the high-res variant.
update tcgcsv_products
set image_url = regexp_replace(image_url, '_[0-9]+w\.jpg$', '_in_1000x1000.jpg')
where image_url ~ '_[0-9]+w\.jpg$';

-- 3) Refresh featured materialized views (they embed image_url). Runs as
--    postgres here, so no anon statement-timeout. Each refreshed if present.
do $$
declare
    v text;
begin
    foreach v in array array[
        'featured_pokemon_cards',
        'featured_pokemon_cards_jp',
        'featured_onepiece_cards'
    ]
    loop
        if exists (
            select 1 from pg_matviews
            where schemaname = 'public' and matviewname = v
        ) then
            execute format('refresh materialized view %I', v);
        end if;
    end loop;
end $$;

-- 4) (sanity) should be 0 after the update.
select count(*) as low_res_left
from tcgcsv_products
where image_url ~ '_[0-9]+w\.jpg$';
