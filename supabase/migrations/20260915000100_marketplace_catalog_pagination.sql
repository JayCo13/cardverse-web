-- Additive read API. Invoker security preserves listing/profile/offer RLS.
begin;
create or replace function public.marketplace_catalog_page(p_filters jsonb default '{}'::jsonb, p_sort text default 'newest', p_page integer default 1)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
with active as materialized (
  select c.*, jsonb_build_object(
    'display_name', p.display_name, 'profile_image_url', p.profile_image_url,
    'seller_verified', p.seller_verified, 'seller_review_count', p.seller_review_count,
    'shipping_carriers', p.shipping_carriers, 'reputation_score', p.reputation_score,
    'reputation_incidents_90d', p.reputation_incidents_90d,
    'reputation_incidents_total', p.reputation_incidents_total,
    'completed_transactions', p.completed_transactions
  ) as profiles
  from public.cards c left join public.profiles p on p.id = c.seller_id
  where c.listing_type = 'sale' and c.status = 'active'
), filtered as materialized (
  select * from active c where
    (coalesce(p_filters->>'productKind','all') = 'all' or coalesce(c.product_kind,'card') = p_filters->>'productKind')
    and (coalesce(p_filters->>'search','') = '' or strpos(lower(concat_ws(' ',c.name,c.product_type_label,
      (select string_agg(value,' ') from jsonb_each_text(coalesce(c.product_details,'{}'::jsonb))),
      c.card_number,c.publisher,c.set_name,c.season,c.profiles->>'display_name')),lower(p_filters->>'search')) > 0)
    and (coalesce(jsonb_array_length(p_filters->'categories'),0)=0 or c.category = any(array(select jsonb_array_elements_text(p_filters->'categories'))))
    and (coalesce(jsonb_array_length(p_filters->'conditions'),0)=0 or c.condition = any(array(select jsonb_array_elements_text(p_filters->'conditions'))))
    and (coalesce(jsonb_array_length(p_filters->'publishers'),0)=0 or c.publisher = any(array(select jsonb_array_elements_text(p_filters->'publishers'))))
    and (coalesce(jsonb_array_length(p_filters->'sets'),0)=0 or c.set_name = any(array(select jsonb_array_elements_text(p_filters->'sets'))))
    and (coalesce(nullif(p_filters->>'minPrice','')::numeric,0)<=0 or coalesce(c.price,0)>= (p_filters->>'minPrice')::numeric)
    and (coalesce(nullif(p_filters->>'maxPrice','')::numeric,0)<=0 or coalesce(c.price,0)<= (p_filters->>'maxPrice')::numeric)
    and (not coalesce((p_filters->>'acceptsOffers')::boolean,false) or c.accept_offers)
    and (not coalesce((p_filters->>'verifiedSellers')::boolean,false) or (c.profiles->>'seller_verified')::boolean)
    and (not coalesce((p_filters->>'bundlesOnly')::boolean,false) or c.is_bundle)
    and (not coalesce((p_filters->>'gradedOnly')::boolean,false) or (c.grading_company is not null and c.grading_company <> 'raw'))
), counts as (select count(*) as n from filtered), selected_page as (
  select least(greatest(p_page,1),greatest(1,ceil(n/15.0)::integer)) as n from counts
), page_rows as (
  select c.id,c.name,c.product_kind,c.product_type_label,c.product_details,c.image_url,c.image_urls,
    c.category,c.condition,c.listing_type,c.price,c.seller_id,c.profiles,c.description,c.last_sold_price,
    c.status,c.publisher,c.set_name,c.season,c.quantity,c.is_bundle,c.bundle_items,c.accept_offers,
    c.min_offer_percent,c.card_number,c.language,c.grading_company,c.grade,c.created_at,c.shipping_fee,
    (select o.status from public.offers o where o.card_id=c.id and o.buyer_id=auth.uid() order by o.created_at desc,o.id desc limit 1) as buyer_offer_status
  from filtered c
  order by case when p_sort='price-asc' then coalesce(c.price,0) end asc,
    case when p_sort='price-desc' then coalesce(c.price,0) end desc,
    case when p_sort not in ('price-asc','price-desc') then c.created_at end desc nulls last,c.id desc
  limit 15 offset ((select n from selected_page)-1)*15
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
  'count',(select n from counts),'total',(select count(*) from active),'page',(select n from selected_page),
  'facets',jsonb_build_object(
    'publishers',coalesce((select jsonb_agg(v order by v) from (select distinct publisher v from active where publisher is not null and publisher<>'') q),'[]'::jsonb),
    'sets',coalesce((select jsonb_agg(v order by v) from (select distinct set_name v from active where set_name is not null and set_name<>'') q),'[]'::jsonb),
    'conditions',coalesce((select jsonb_agg(v order by v) from (select distinct condition v from active where condition is not null and condition<>'') q),'[]'::jsonb),
    'categories',coalesce((select jsonb_object_agg(category,n) from (select category,count(*) n from active where category is not null group by category) q),'{}'::jsonb)
  ));
$$;
revoke all on function public.marketplace_catalog_page(jsonb,text,integer) from public;
grant execute on function public.marketplace_catalog_page(jsonb,text,integer) to authenticated;
commit;
