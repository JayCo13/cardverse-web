-- =====================================================================
-- Remove sealed / non-card products from the Pokémon catalog.
--
-- A bad crawl inserted sealed products (booster packs/boxes, Elite Trainer
-- Boxes, tins, code cards, premium collections, cases…) alongside real
-- cards. Real cards have a collector Number in tcgcsv_products.number;
-- sealed products have none — that's the discriminator.
--
-- Run in the Supabase SQL Editor. Steps are separate; review the preview
-- before running the DELETE.
-- =====================================================================

-- 1) PREVIEW — how many rows will be removed, per category (3=EN, 85=JP).
select category_id, count(*) as sealed_rows
from tcgcsv_products
where category_id in (3, 85)
  and (number is null or btrim(number) = '')
group by category_id;

-- (optional) eyeball some of them:
-- select name, number, market_price from tcgcsv_products
-- where category_id in (3,85) and (number is null or btrim(number) = '')
-- limit 50;

-- 2) DELETE the sealed / non-card products.
delete from tcgcsv_products
where category_id in (3, 85)
  and (number is null or btrim(number) = '');

-- 3) Refresh the Pokémon materialized views so sets/featured reflect the
--    cleanup. Runs here as the postgres role (not the anon RPC), so it is
--    not subject to the short statement timeout. Each view refreshed only
--    if it exists.
do $$
declare
    v text;
begin
    foreach v in array array[
        'pokemon_sets_en',
        'pokemon_sets_jp',
        'featured_pokemon_cards',
        'featured_pokemon_cards_jp'
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

-- 4) (sanity) remaining Pokémon products should now be cards only.
select category_id, count(*) as cards_left
from tcgcsv_products
where category_id in (3, 85)
group by category_id;
