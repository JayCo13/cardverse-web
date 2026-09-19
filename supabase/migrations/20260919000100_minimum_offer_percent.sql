create or replace function public.enforce_minimum_offer_percent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.accept_offers, false)
     and (new.min_offer_percent is null or new.min_offer_percent not between 5 and 99) then
    raise exception 'invalid_listing_payload';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_minimum_offer_percent on public.cards;
create trigger enforce_minimum_offer_percent
before insert or update of accept_offers, min_offer_percent on public.cards
for each row execute function public.enforce_minimum_offer_percent();
