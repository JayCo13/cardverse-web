-- Replace the flat ninety-day offer ban with a ladder, and give people a way out
-- of it that does not involve waiting.
--
-- 20260909000200 copied eBay's rule directly: two unpaid offers in a window and
-- offers are gone for ninety days. On eBay that is survivable — there are more
-- buyers than any seller can serve, so shedding the unreliable ones costs
-- nothing. On a marketplace this size it reads as "two mistakes and the feature
-- is gone until December", and the buyer who reads that leaves.
--
-- The deterrent was never the length. It is knowing the next one costs more:
--
--     1st unpaid   nothing but the −5 and a notification
--     2nd          offers paused 7 days
--     3rd          30 days
--     4th and on   90 days
--
-- And a completed order clears a strike. Someone who has slipped twice does not
-- have to sit out the week — they can buy something, receive it, confirm it, and
-- be clear. That turns the penalty into a route back, and the route runs through
-- the behaviour the marketplace actually wants.
--
-- Voluntary releases (`buyer_cancelled`) no longer count toward the ladder at
-- all. They still cost 5 points, per the agreed table, but pressing "release the
-- card" hands the seller their queue back inside a minute instead of an hour, and
-- charging it the same strike as going silent left nobody any reason to press it.

-- The authority on whether someone may send an offer. Returns null when they
-- may, or the moment the restriction lifts when they may not.
--
-- Computed rather than stored, because the answer changes with the passage of
-- time and with orders completing, neither of which writes to this row. A
-- `profiles.offer_restricted_until` column would have to be recomputed by
-- something, and nothing here would ever run to do it; the trigger and the
-- offer modal both ask this function instead, so there is one answer rather
-- than a stored copy that drifts.
create or replace function public.offer_restriction_until(p_user_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_first timestamptz;
  v_last timestamptz;
  v_strikes integer;
  v_forgiven integer;
  v_until timestamptz;
begin
  select min(created_at), max(created_at), count(*)
  into v_first, v_last, v_strikes
  from public.reputation_events
  where user_id = p_user_id
    and voided_at is null
    and event_type = 'offer_unpaid'
    and created_at > now() - interval '90 days';

  if coalesce(v_strikes, 0) = 0 then
    return null;
  end if;

  -- Orders this person completed as a buyer since their first slip. Each one
  -- cancels a strike: having gone through with a purchase is better evidence
  -- than having waited out a timer.
  select count(*)
  into v_forgiven
  from public.reputation_events
  where user_id = p_user_id
    and voided_at is null
    and event_type = 'order_completed'
    and role = 'buyer'
    and created_at > v_first;

  v_strikes := greatest(0, v_strikes - coalesce(v_forgiven, 0));

  v_until := case
    when v_strikes < 2 then null
    when v_strikes = 2 then v_last + interval '7 days'
    when v_strikes = 3 then v_last + interval '30 days'
    else v_last + interval '90 days'
  end;

  -- A restriction whose end has passed is not a restriction.
  if v_until is null or v_until <= now() then
    return null;
  end if;
  return v_until;
end;
$fn$;

revoke all on function public.offer_restriction_until(uuid) from public, anon;
grant execute on function public.offer_restriction_until(uuid) to authenticated, service_role;

-- ─── Wiring the ladder into the gate ─────────────────────────────────────────
--
-- Without this the function above is dead code. 20260909000200 wrote the gate as
-- a literal `recent_incident_count(...) >= 2`, so the ladder, the forgiveness
-- rule and the exclusion of `buyer_cancelled` all sat in a file the trigger
-- never read: a buyer who slipped twice was still gone for ninety days.
--
-- Only the reputation half changes. The five-attempts-per-card rule is carried
-- forward verbatim, and stays first: "you have used your five offers on this
-- card" is a truthful answer to somebody who is also restricted, and it is the
-- one that tells them something they can act on.
--
-- The deadline travels inside the message because a trigger cannot return a
-- payload alongside a raise. ISO-8601 in UTC rather than `%` on the timestamptz,
-- whose output follows the session's TimeZone and would reach the browser as an
-- unparseable local string.
create or replace function public.enforce_offer_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_attempts integer;
  v_until timestamptz;
begin
  select count(*) into v_attempts
  from public.offers
  where card_id = new.card_id and buyer_id = new.buyer_id;

  if v_attempts >= 5 then
    raise exception 'offer_limit_reached';
  end if;

  v_until := public.offer_restriction_until(new.buyer_id);
  if v_until is not null then
    raise exception 'offer_blocked_reputation until %',
      to_char(v_until at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  return new;
end;
$fn$;

-- `create or replace` preserves both the ACL and the trigger binding from
-- 20260909000200, so neither is recreated here. The revoke is repeated only so
-- that replaying this file against a database that never ran 000200 still ends
-- with a function no client can call directly.
revoke all on function public.enforce_offer_limits() from public, anon, authenticated;

notify pgrst, 'reload schema';
