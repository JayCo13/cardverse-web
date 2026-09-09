-- Stop clients from writing their own reputation, and stop them reading anyone
-- else's incident history.
--
-- Three holes, all the same shape: a figure the marketplace presents as fact is
-- reachable by the person it describes.
--
--   1. `profiles` carries nine derived columns — the four ledger ones plus the
--      legacy volume stats — and nothing stops an authenticated user from
--      PATCHing them. RLS is row-level, not column-level, and no column GRANT
--      narrows the table, so the browser client that legitimately updates a
--      display name can set `completed_transactions = 200` and
--      `reputation_incidents_total = 0` in the same request. The badge reads
--      exactly those columns, so the account renders as "Uy tín cao · 200 đơn".
--      `recompute_reputation` would correct it, but only when that user next
--      earns a ledger row — somebody who forges and then stops trading keeps
--      the forged figures indefinitely.
--
--   2. `recent_incident_count(uuid, integer, text[])` is security definer and
--      granted to `authenticated`, takes any user id, and defaults to counting
--      every negative event type. Any signed-in account can enumerate anyone
--      else's incident history — the exact information 20260909000700 scoped
--      and the public badge deliberately stopped showing.
--
--   3. `update_seller_reputation(uuid, integer, integer)` is also granted to
--      `authenticated`, and it takes the seller id and the deltas as arguments.
--      A client can call it with its own id to mint a 100% rating, or with a
--      competitor's id to bury one. Both call sites in the app already go
--      through the service role, so nothing legitimate needs that grant.
--
-- The fix for 1 is a denylist, not an allowlist. Column GRANTs would mean
-- enumerating every column the client may write, and eight different surfaces
-- write address and shipping fields today; one missed column silently breaks
-- sign-in or the address form. Instead a trigger reverts the derived columns
-- unless the write announces itself, and the only two functions allowed to
-- write them do so.

-- ─── The announcement ────────────────────────────────────────────────────────
--
-- A transaction-local GUC rather than `auth.role()`. Role is the wrong test:
-- `recompute_reputation` runs from a trigger on `orders`, so the session role
-- there is whoever confirmed the delivery, and a role check would have silently
-- reverted the ledger's own writes. This says what actually matters — "this
-- UPDATE came from the function that owns these columns" — and each writer
-- clears it immediately, so the permission never outlives the statement.
create or replace function public.guard_reputation_columns()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(current_setting('cardverse.reputation_write', true), '') <> 'on' then
    new.reputation_score           := old.reputation_score;
    new.reputation_incidents_90d   := old.reputation_incidents_90d;
    new.reputation_incidents_total := old.reputation_incidents_total;
    new.completed_transactions     := old.completed_transactions;
    new.total_transactions         := old.total_transactions;
    new.seller_rating              := old.seller_rating;
    new.seller_review_count        := old.seller_review_count;
    new.seller_fault_count         := old.seller_fault_count;
    new.legit_rate                 := old.legit_rate;
  end if;
  return new;
end;
$fn$;

drop trigger if exists guard_reputation_columns on public.profiles;
create trigger guard_reputation_columns
  before update on public.profiles
  for each row
  execute function public.guard_reputation_columns();

-- ─── Writer 1: the ledger projection ─────────────────────────────────────────
--
-- Body carried forward from 20260909000800 unchanged; only the two set_config
-- calls are new.
create or replace function public.recompute_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform set_config('cardverse.reputation_write', 'on', true);

  update public.profiles p
  set reputation_score = coalesce(agg.score, 0),
      reputation_incidents_90d = coalesce(agg.incidents, 0),
      reputation_incidents_total = coalesce(agg.incidents_total, 0),
      completed_transactions = coalesce(agg.completed, 0),
      updated_at = now()
  from (
    select
      sum(e.delta) as score,
      count(*) filter (
        where e.delta < 0 and e.created_at > now() - interval '90 days'
      ) as incidents,
      count(*) filter (where e.delta < 0) as incidents_total,
      count(*) filter (where e.event_type = 'order_completed') as completed
    from public.reputation_events e
    where e.user_id = p_user_id and e.voided_at is null
  ) agg
  where p.id = p_user_id;

  perform set_config('cardverse.reputation_write', 'off', true);
end;
$fn$;

-- ─── Writer 2: the nightly window sweep ──────────────────────────────────────
--
-- This one writes `reputation_incidents_90d` with a bare UPDATE rather than
-- going through recompute_reputation, so without the flag the guard would have
-- frozen the ⚠️ badge forever — an incident would never age out.
create or replace function public.recompute_stale_reputation_windows()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  perform set_config('cardverse.reputation_write', 'on', true);

  with affected as (
    select p.id
    from public.profiles p
    where p.reputation_incidents_90d > 0
       or exists (
         select 1 from public.reputation_events e
         where e.user_id = p.id and e.voided_at is null and e.delta < 0
           and e.created_at > now() - interval '100 days'
       )
  ),
  updated as (
    update public.profiles p
    set reputation_incidents_90d = coalesce(agg.incidents, 0)
    from affected a
    left join lateral (
      select count(*) as incidents
      from public.reputation_events e
      where e.user_id = a.id and e.voided_at is null and e.delta < 0
        and e.created_at > now() - interval '90 days'
    ) agg on true
    where p.id = a.id and p.reputation_incidents_90d is distinct from coalesce(agg.incidents, 0)
    returning p.id
  )
  select count(*) into v_count from updated;

  perform set_config('cardverse.reputation_write', 'off', true);
  return v_count;
end;
$fn$;

-- ─── Writer 3: the legacy volume stats ───────────────────────────────────────
--
-- Body carried forward from 20260707_ship_deadline_reputation unchanged; the
-- set_config calls and the narrower grant below are the only changes. These
-- columns no longer appear anywhere in the marketplace UI, but `legit_rate`
-- still gates the forum and the counters still run on a 30-minute cron, so they
-- are protected on the same terms as the ledger's.
create or replace function public.update_seller_reputation(
  p_seller_id uuid,
  p_success integer,
  p_fault integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_review integer;
  v_fault integer;
  v_total integer;
begin
  perform set_config('cardverse.reputation_write', 'on', true);

  update public.profiles
     set seller_review_count = greatest(0, coalesce(seller_review_count, 0) + coalesce(p_success, 0)),
         seller_fault_count  = greatest(0, coalesce(seller_fault_count, 0) + coalesce(p_fault, 0)),
         updated_at = now()
   where id = p_seller_id
  returning seller_review_count, seller_fault_count into v_review, v_fault;

  v_total := coalesce(v_review, 0) + coalesce(v_fault, 0);

  update public.profiles
     set seller_rating = case when v_total > 0
                              then round((v_review::numeric / v_total) * 100, 1)
                              else 0 end
   where id = p_seller_id;

  perform set_config('cardverse.reputation_write', 'off', true);
end;
$fn$;

-- ─── Close the two RPC grants ────────────────────────────────────────────────
--
-- Neither is called from the browser. `recent_incident_count` has no caller in
-- `src` at all — it is only ever reached from inside enforce_offer_limits and
-- offer_gate_for_card, both security definer, which run as the owner and are
-- unaffected by this. `update_seller_reputation` is called twice, both through
-- the service-role client.
revoke execute on function public.recent_incident_count(uuid, integer, text[]) from authenticated;
revoke execute on function public.update_seller_reputation(uuid, integer, integer) from authenticated;
revoke all on function public.guard_reputation_columns() from public, anon, authenticated;

notify pgrst, 'reload schema';
