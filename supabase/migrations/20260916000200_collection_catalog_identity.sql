-- Preserve the canonical card identity when a catalog card is saved to a
-- collection, so selecting it later in /sell/create does not lose its set,
-- collector number or language.
alter table public.user_collections
  add column if not exists catalog_product_id integer,
  add column if not exists catalog_soccer_id bigint,
  add column if not exists set_name text,
  add column if not exists card_number text,
  add column if not exists language text;

alter table public.user_collections
  drop constraint if exists user_collections_language_check;

alter table public.user_collections
  add constraint user_collections_language_check
  check (language is null or language in ('en', 'jp'));

create index if not exists idx_user_collections_catalog_product
  on public.user_collections (catalog_product_id)
  where catalog_product_id is not null;

create index if not exists idx_user_collections_catalog_soccer
  on public.user_collections (catalog_soccer_id)
  where catalog_soccer_id is not null;

-- Use the same canonical category values as the listing form.
update public.user_collections
set category = case
  when lower(trim(category)) in ('pokemon', 'pokémon') then 'Pokémon'
  when lower(trim(category)) in ('soccer', 'football', 'bóng đá') then 'Bóng đá'
  when lower(replace(trim(category), ' ', '')) = 'onepiece' then 'One Piece'
  else category
end
where category is not null;

-- Existing catalog collection rows normally retain the exact TCGCSV image URL.
-- Backfill only when that URL identifies one and only one product.
with image_matches as (
  select uc.id as collection_id, min(p.product_id) as product_id
  from public.user_collections uc
  join public.tcgcsv_products p on p.image_url = uc.image_url
  where uc.catalog_product_id is null
    and uc.image_url is not null
    and uc.category in ('Pokémon', 'One Piece')
    and p.category_id in (3, 68, 85)
    and ((uc.category = 'One Piece' and p.category_id = 68)
      or (uc.category = 'Pokémon' and p.category_id in (3, 85)))
  group by uc.id
  having count(*) = 1
)
update public.user_collections uc
set catalog_product_id = p.product_id,
    set_name = coalesce(uc.set_name, p.set_name),
    card_number = coalesce(uc.card_number, p.number),
    language = coalesce(uc.language, case when p.category_id = 85 then 'jp' else 'en' end)
from image_matches m, public.tcgcsv_products p
where uc.id = m.collection_id
  and p.product_id = m.product_id;

-- Some legacy rows have no image but an unambiguous title inside their
-- category. Never backfill a title that maps to multiple catalog products.
with title_matches as (
  select uc.id as collection_id, min(p.product_id) as product_id
  from public.user_collections uc
  join public.tcgcsv_products p on lower(p.name) = lower(uc.title)
  where uc.catalog_product_id is null
    and uc.category in ('Pokémon', 'One Piece')
    and ((uc.category = 'One Piece' and p.category_id = 68)
      or (uc.category = 'Pokémon' and p.category_id in (3, 85)))
  group by uc.id
  having count(*) = 1
)
update public.user_collections uc
set catalog_product_id = p.product_id,
    set_name = coalesce(uc.set_name, p.set_name),
    card_number = coalesce(uc.card_number, p.number),
    language = coalesce(uc.language, case when p.category_id = 85 then 'jp' else 'en' end)
from title_matches m, public.tcgcsv_products p
where uc.id = m.collection_id
  and p.product_id = m.product_id;
