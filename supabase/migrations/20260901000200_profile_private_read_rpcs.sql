-- Two read paths that will survive locking `profiles` down to its public
-- columns.
--
-- `profiles` serves two opposite purposes from one table: a seller's public
-- card, and the account owner's private details. Row-level security filters
-- rows, not columns, and every row here has to stay publicly readable in part —
-- so the column limit has to come from GRANT, and GRANT cannot tell the owner's
-- row from anyone else's. Both reads that need a private column therefore move
-- behind a definer function that makes the row check itself.
--
-- This migration only adds the functions. Nothing is revoked yet: the code has
-- to be using them before the columns close, or every user loses their own
-- profile the moment the grant lands.

create or replace function public.get_my_profile()
returns public.profiles
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select * from public.profiles where id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- The phone numbers behind one offer, for the two people trading it.
--
-- The connect page builds Zalo links from these. Returns nothing to anyone who
-- is not the buyer or the seller of that offer, so a phone number is only ever
-- disclosed to the person on the other side of a trade that already exists.
create or replace function public.get_trade_contact(p_offer_id uuid)
returns table (user_id uuid, phone_number text)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_buyer uuid;
  v_seller uuid;
begin
  select o.buyer_id, c.seller_id
    into v_buyer, v_seller
  from public.offers o
  join public.cards c on c.id = o.card_id
  where o.id = p_offer_id;

  if v_buyer is null then
    return;
  end if;

  -- The caller must be one of the two. Anyone else gets an empty set rather
  -- than an error: the page simply shows no contact details.
  if auth.uid() is distinct from v_buyer and auth.uid() is distinct from v_seller then
    return;
  end if;

  return query
  select p.id, p.phone_number
  from public.profiles p
  where p.id in (v_buyer, v_seller);
end;
$$;

revoke all on function public.get_trade_contact(uuid) from public, anon;
grant execute on function public.get_trade_contact(uuid) to authenticated;
