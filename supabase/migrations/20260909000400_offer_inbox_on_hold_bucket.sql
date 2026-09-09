-- Give `on_hold` a bucket in the offer inbox.
--
-- 20260906000200 filters on an exhaustive list of statuses, so the status added
-- by 20260909000200 matches none of them: a held offer disappears from every tab
-- except "all", and is missing from all three counts. The buyers queued behind
-- an accepted offer are exactly the people who most need to see their offer is
-- still alive — showing them nothing is what a rejection used to do, which is
-- the behaviour this whole change set exists to remove.
--
-- Identical to the previous definition apart from the one `on_hold` line.

create or replace function public.get_offer_inbox_card_page(
  p_view text,
  p_status text,
  p_sort text,
  p_limit integer default 6,
  p_cursor jsonb default null
)
returns table (
  card_id uuid,
  offer_ids uuid[],
  offer_count bigint,
  anchor_price numeric,
  anchor_created_at timestamptz,
  anchor_id uuid
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with filtered as (
    select o.id, o.card_id, o.price, o.created_at
    from public.offers o
    join public.cards c on c.id = o.card_id
    where (
      (p_view = 'received' and c.seller_id = auth.uid())
      or (p_view = 'sent' and o.buyer_id = auth.uid())
    )
      and (
        p_status = 'all'
        or (p_status = 'pending' and o.status = 'pending')
        or (p_status = 'on_hold' and o.status = 'on_hold')
        or (p_status = 'awaiting_payment' and o.status = 'chosen')
        or (p_status = 'history' and o.status in ('accepted', 'rejected', 'expired'))
      )
  ),
  ranked as (
    select
      f.*,
      row_number() over (
        partition by f.card_id
        order by
          case when p_sort = 'price_asc' then f.price end asc,
          case when p_sort = 'price_desc' then f.price end desc,
          f.created_at desc,
          f.id desc
      ) as position
    from filtered f
  ),
  grouped as (
    select
      r.card_id,
      (array_agg(r.id order by r.position) filter (where r.position <= 3))::uuid[] as offer_ids,
      count(*) as offer_count,
      (array_agg(r.price order by r.position))[1] as anchor_price,
      (array_agg(r.created_at order by r.position))[1] as anchor_created_at,
      (array_agg(r.id order by r.position))[1] as anchor_id
    from ranked r
    group by r.card_id
  )
  select
    g.card_id,
    g.offer_ids,
    g.offer_count,
    g.anchor_price,
    g.anchor_created_at,
    g.anchor_id
  from grouped g
  where p_cursor is null
    or (
      p_sort = 'price_asc'
      and (
        g.anchor_price > (p_cursor ->> 'price')::numeric
        or (g.anchor_price = (p_cursor ->> 'price')::numeric and g.anchor_created_at < (p_cursor ->> 'createdAt')::timestamptz)
        or (g.anchor_price = (p_cursor ->> 'price')::numeric and g.anchor_created_at = (p_cursor ->> 'createdAt')::timestamptz and g.anchor_id < (p_cursor ->> 'id')::uuid)
      )
    )
    or (
      p_sort = 'price_desc'
      and (
        g.anchor_price < (p_cursor ->> 'price')::numeric
        or (g.anchor_price = (p_cursor ->> 'price')::numeric and g.anchor_created_at < (p_cursor ->> 'createdAt')::timestamptz)
        or (g.anchor_price = (p_cursor ->> 'price')::numeric and g.anchor_created_at = (p_cursor ->> 'createdAt')::timestamptz and g.anchor_id < (p_cursor ->> 'id')::uuid)
      )
    )
    or (
      p_sort = 'newest'
      and (
        g.anchor_created_at < (p_cursor ->> 'createdAt')::timestamptz
        or (g.anchor_created_at = (p_cursor ->> 'createdAt')::timestamptz and g.anchor_id < (p_cursor ->> 'id')::uuid)
      )
    )
  order by
    case when p_sort = 'price_asc' then g.anchor_price end asc,
    case when p_sort = 'price_desc' then g.anchor_price end desc,
    g.anchor_created_at desc,
    g.anchor_id desc
  limit greatest(1, least(p_limit, 21));
$fn$;

revoke all on function public.get_offer_inbox_card_page(text, text, text, integer, jsonb) from public, anon;
grant execute on function public.get_offer_inbox_card_page(text, text, text, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
