begin;
create or replace function public.collection_page(p_search text default '', p_album uuid default null, p_category text default null, p_page integer default 1)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
with owned as materialized (
  select * from public.user_collections where user_id = auth.uid()
), filtered as materialized (
  select * from owned where (p_album is null or album_id=p_album)
    and (p_category is null or category=p_category)
    and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',title,category,rarity)),lower(p_search))>0)
), counts as (select count(*) n from filtered), selected_page as (
  select least(greatest(p_page,1),greatest(1,ceil(n/24.0)::integer)) n from counts
), page_rows as (
  select * from filtered order by created_at desc,id desc limit 24 offset ((select n from selected_page)-1)*24
), album_rows as (
  select a.*, (select count(*) from owned c where c.album_id=a.id) card_count,
    (select coalesce(sum(market_price),0) from owned c where c.album_id=a.id) total_value
  from public.albums a where a.user_id=auth.uid() order by a.created_at desc,a.id desc
)
select jsonb_build_object(
  'cards',coalesce((select jsonb_agg(to_jsonb(c)) from page_rows c),'[]'::jsonb),
  'count',(select n from counts),'page',(select n from selected_page),
  'albums',coalesce((select jsonb_agg(to_jsonb(a)) from album_rows a),'[]'::jsonb),
  'stats',jsonb_build_object('totalCards',(select count(*) from owned),
    'totalValue',(select coalesce(sum(market_price),0) from owned),
    'mostValuable',(select to_jsonb(c) from owned c order by market_price desc nulls last,id desc limit 1),
    'categories',coalesce((select jsonb_agg(category) from (select distinct category from owned where category is not null) q),'[]'::jsonb))
);
$$;
revoke all on function public.collection_page(text,uuid,text,integer) from public;
grant execute on function public.collection_page(text,uuid,text,integer) to authenticated;

create or replace function public.profile_transaction_totals()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
select jsonb_build_object(
 'grossRevenue',coalesce(sum(price) filter(where seller_id=auth.uid() and status='completed'),0),
 'totalSpent',coalesce(sum(price) filter(where buyer_id=auth.uid() and status='completed'),0),
 'boughtCount',count(*) filter(where buyer_id=auth.uid() and status='completed'))
from public.transactions where seller_id=auth.uid() or buyer_id=auth.uid();
$$;
revoke all on function public.profile_transaction_totals() from public;
grant execute on function public.profile_transaction_totals() to authenticated;
commit;
