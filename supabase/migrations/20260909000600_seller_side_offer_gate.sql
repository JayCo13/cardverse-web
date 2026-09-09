-- Take the offer ban off the platform and hand the switch to the seller.
--
-- 20260909000500 replaced a flat ninety-day ban with a ladder. Research into
-- what the two marketplaces this design keeps citing actually do says the whole
-- shape was wrong, ladder included:
--
--   eBay runs two separate layers. The platform records an unpaid-item strike
--   and says only that "restrictions on buying, bidding, and making offers" may
--   follow — no published threshold, no published duration. The layer that
--   actually blocks anybody is Buyer Requirements, a per-seller setting: each
--   seller chooses whether to block at all, and at how many strikes (2 to 5).
--   Most leave it off. A blocked buyer is blocked from the listings of sellers
--   who opted in, not from eBay, and can still buy at a fixed price throughout.
--
--   Airbnb has no points and no thresholds. A host who cancels pays a fee, has
--   the calendar blocked for those dates, and may lose Superhost. Suspension is
--   discretionary language for repeat offenders. A guest who cancels faces the
--   refund schedule and nothing else — no strike, no restriction.
--
-- Both charge a cost and publish a signal. Neither takes the capability away on
-- a published schedule, and neither decides for the seller who is worth dealing
-- with. Our ladder was stricter than eBay's platform layer while also removing
-- the choice eBay leaves to sellers — and the cost lands on the seller, who
-- loses a bidder, not on the platform that imposed it.
--
-- So: the −5 and the ⚠️ badge stay and become the whole of the automatic
-- response. Blocking becomes something a seller opts into.

-- ─── The platform ban, removed ───────────────────────────────────────────────
--
-- Dropped rather than left unused. An unused security-definer function that
-- `authenticated` may still call is how the last mismatch survived unnoticed;
-- the gate below is the only thing that decides who may offer.
drop function if exists public.offer_restriction_until(uuid);

-- ─── The seller's switch ─────────────────────────────────────────────────────
--
-- Null means off, and off is the default and the overwhelmingly common case —
-- the same as eBay, where the setting exists for the minority of sellers who
-- have actually been burned. 2 to 5 is eBay's range verbatim; the window is
-- fixed at the ninety days every other count in this schema already uses,
-- rather than eBay's 1/6/12-month choice, because a second dial buys precision
-- nobody asked for.
alter table public.profiles
  add column if not exists offer_block_incidents smallint;

alter table public.profiles
  drop constraint if exists profiles_offer_block_incidents_check;
alter table public.profiles
  add constraint profiles_offer_block_incidents_check
  check (offer_block_incidents is null or offer_block_incidents between 2 and 5);

-- ─── The gate ────────────────────────────────────────────────────────────────
--
-- Counts from `reputation_events` through recent_incident_count, never from
-- `profiles.reputation_incidents_90d`. That column is a denormalised copy on a
-- row its owner can update, and it counts every negative event including the
-- ones a seller earned on the selling side — reading it here is exactly the
-- mistake the offer modal was making. The ledger has no client write path.
--
-- `buyer_cancelled` is deliberately not counted. eBay does count a buyer's
-- cancellation request as an unpaid item, and we depart from it on purpose:
-- releasing the card hands the seller their queue back in seconds instead of an
-- hour, and charging it like silence leaves nobody a reason to press the button.
-- It still costs the buyer 5 points.
create or replace function public.enforce_offer_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_attempts integer;
  v_threshold smallint;
begin
  select count(*) into v_attempts
  from public.offers
  where card_id = new.card_id and buyer_id = new.buyer_id;

  if v_attempts >= 5 then
    raise exception 'offer_limit_reached';
  end if;

  select p.offer_block_incidents into v_threshold
  from public.cards c
  join public.profiles p on p.id = c.seller_id
  where c.id = new.card_id;

  if v_threshold is not null
     and public.recent_incident_count(
           new.buyer_id, 90, array['offer_unpaid','buyer_fraud']) >= v_threshold then
    raise exception 'offer_blocked_by_seller';
  end if;

  return new;
end;
$fn$;

revoke all on function public.enforce_offer_limits() from public, anon, authenticated;

-- ─── What the modal asks before drawing a form ───────────────────────────────
--
-- Takes no user id: the buyer is `auth.uid()` and cannot be anyone else. The
-- function it replaces took the id as an argument and was granted to
-- `authenticated`, which let any signed-in account ask about any other.
create or replace function public.offer_gate_for_card(p_card_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_buyer uuid := auth.uid();
  v_threshold smallint;
  v_incidents integer;
begin
  if v_buyer is null then raise exception 'unauthorized'; end if;

  select p.offer_block_incidents into v_threshold
  from public.cards c
  join public.profiles p on p.id = c.seller_id
  where c.id = p_card_id;

  if v_threshold is null then
    return jsonb_build_object('blocked', false);
  end if;

  v_incidents := public.recent_incident_count(
    v_buyer, 90, array['offer_unpaid','buyer_fraud']);

  return jsonb_build_object(
    'blocked', v_incidents >= v_threshold,
    'incidents', v_incidents,
    'threshold', v_threshold);
end;
$fn$;

revoke all on function public.offer_gate_for_card(uuid) from public, anon;
grant execute on function public.offer_gate_for_card(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
