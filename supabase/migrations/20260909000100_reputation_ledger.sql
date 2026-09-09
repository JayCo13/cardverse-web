-- An append-only ledger for buyer and seller standing, and the two derived
-- columns the UI reads.
--
-- Two half-systems exist today and neither can answer "why is this number what
-- it is". `profiles.legit_rate` starts at 100 and is decremented in place by the
-- offer sweep; `profiles.seller_rating` is a percentage recomputed from two
-- counters. Both are written with a bare UPDATE, so a wrong penalty is
-- unrecoverable: 20260904000100 had to hand-write a repair UPDATE to give back
-- points the sweeper had taken from buyers who had in fact paid. There was no
-- record of who had been docked, so the repair had to re-derive it from orders.
--
-- Everything here is designed around that failure:
--
--   * every change to standing is a row, never an in-place decrement
--   * a wrong row is voided, not deleted, and the score is recomputed
--   * the same offer can never be charged twice, enforced by an index rather
--     than by the caller remembering — the sweep runs every two minutes and
--     will see the same expired offer on consecutive passes
--
-- Both percentage columns are deliberately left alone. `legit_rate` gates forum
-- posting at >= 90 and is displayed on /forum and /profile; `seller_rating` is
-- the "% completed · N sold" figure on the card page. They are volume statistics
-- and this is a conduct score — eBay likewise shows Feedback Score next to
-- Feedback %, and conflating them is what makes one perfect sale look better
-- than a hundred good ones.

create table if not exists public.reputation_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Which side of the trade this person was on. The same account is a buyer on
  -- one order and a seller on the next, and the deltas differ by side.
  role        text not null check (role in ('buyer','seller')),
  event_type  text not null check (event_type in (
                'order_completed','offer_unpaid','buyer_cancelled',
                'seller_cancelled','seller_wrong_item','buyer_fraud',
                'seller_counterfeit','no_fault','admin_adjust')),
  delta       integer not null,
  order_id    uuid references public.orders(id) on delete set null,
  offer_id    uuid references public.offers(id) on delete set null,
  card_id     uuid references public.cards(id) on delete set null,
  note        text,
  -- Null means the system wrote it. Set for admin_adjust and for the dispute
  -- verdicts, which only a person can decide.
  --
  -- Text, not a uuid FK to auth.users, because a moderator is not a Supabase
  -- user: getAdminActor() hands back `moderator:<session id>` for the env-based
  -- login and a uuid only for a promoted admin. Same shape as
  -- set_account_restriction's p_actor_id (20260908000100).
  created_by  text,
  created_by_role text check (created_by_role in ('admin','moderator')),
  voided_at   timestamptz,
  voided_by   text,
  voided_by_role text check (voided_by_role in ('admin','moderator')),
  created_at  timestamptz not null default now()
);

-- Idempotency, and the reason this is an index rather than a check in the
-- caller: `cron_expire_stale_offers` runs every two minutes, and an offer that
-- expires is visible to more than one pass if anything downstream is slow. The
-- predicate excludes voided rows so that voiding a penalty genuinely releases
-- the slot rather than silently blocking any future correction.
create unique index if not exists reputation_events_offer_once
  on public.reputation_events (user_id, event_type, offer_id)
  where offer_id is not null and voided_at is null;
create unique index if not exists reputation_events_order_once
  on public.reputation_events (user_id, event_type, order_id)
  where order_id is not null and voided_at is null;

-- The two read paths: one person's ledger, and "how many incidents in the last
-- N days" for the badge and the offer gate.
create index if not exists reputation_events_user_created_idx
  on public.reputation_events (user_id, created_at desc);
create index if not exists reputation_events_incident_idx
  on public.reputation_events (user_id, created_at desc)
  where delta < 0 and voided_at is null;

alter table public.reputation_events enable row level security;

revoke all on public.reputation_events from anon, authenticated;
-- A person may read their own history, including why they were docked. They may
-- not see which admin did it — that column is for the audit trail, not for them.
grant select (id, user_id, role, event_type, delta, order_id, offer_id, card_id,
              note, voided_at, created_at)
  on public.reputation_events to authenticated;

drop policy if exists reputation_event_self_read on public.reputation_events;
create policy reputation_event_self_read
  on public.reputation_events for select
  to authenticated
  -- `(select auth.uid())` rather than a bare call: as a bare call Postgres
  -- re-evaluates it once per row scanned.
  using (user_id = (select auth.uid()));

-- No write policy. Every insert goes through record_reputation_event below,
-- which is security definer and callable only by service_role, so a client
-- cannot award itself points through PostgREST.

alter table public.profiles
  add column if not exists reputation_score integer not null default 0;
-- Denormalised so a list of twenty cards does not become twenty subqueries.
-- Kept honest by the nightly recompute at the bottom of this file: an incident
-- ages out of the ninety-day window with no write to trigger a refresh.
alter table public.profiles
  add column if not exists reputation_incidents_90d integer not null default 0;
-- Lifetime, for the badge. The ninety-day figure above drives the gates and has
-- to decay; this one never does, because "87 points over 92 orders with 3
-- incidents" is a different thing to a reader than "87 points over 92 orders",
-- and hiding the incidents is how a score stops meaning anything.
alter table public.profiles
  add column if not exists reputation_incidents_total integer not null default 0;

-- ─── The score table, in one place ───────────────────────────────────────────
--
-- Callers pass what happened and which side the person was on; they never pass
-- a number. A caller that decides its own delta is a caller that can disagree
-- with this table, and there are five of them.
create or replace function public.reputation_delta(p_event_type text, p_role text)
returns integer
language sql
immutable
as $fn$
  select case
    when p_event_type = 'order_completed'    then 1
    when p_event_type = 'offer_unpaid'       and p_role = 'buyer'  then -5
    when p_event_type = 'buyer_cancelled'    and p_role = 'buyer'  then -5
    when p_event_type = 'seller_cancelled'   and p_role = 'seller' then -5
    when p_event_type = 'seller_wrong_item'  and p_role = 'seller' then -10
    when p_event_type = 'buyer_fraud'        and p_role = 'buyer'  then -20
    when p_event_type = 'seller_counterfeit' and p_role = 'seller' then -20
    -- 'no_fault' and any event named for the other side of the trade: recorded
    -- so the ledger shows the incident happened, worth nothing either way.
    else 0
  end;
$fn$;

create or replace function public.recompute_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.profiles p
  set reputation_score = coalesce(agg.score, 0),
      reputation_incidents_90d = coalesce(agg.incidents, 0),
      reputation_incidents_total = coalesce(agg.incidents_total, 0),
      updated_at = now()
  from (
    select
      sum(e.delta) as score,
      count(*) filter (
        where e.delta < 0 and e.created_at > now() - interval '90 days'
      ) as incidents,
      count(*) filter (where e.delta < 0) as incidents_total
    from public.reputation_events e
    where e.user_id = p_user_id and e.voided_at is null
  ) agg
  where p.id = p_user_id;
end;
$fn$;

-- How many incidents of a given kind in the last N days.
--
-- Both consumers of standing read this rather than the score: the ⚠️ badge and
-- the offer gate. Gating on the score would let a seller with two hundred
-- completed orders absorb ten no-shows without ever crossing a threshold, while
-- a new buyer goes negative on their first mistake — wrong at both ends. A count
-- in a window is also self-clearing: nothing has to run to lift the restriction,
-- the old incident simply falls out of the window.
create or replace function public.recent_incident_count(
  p_user_id uuid,
  p_days integer default 90,
  p_event_types text[] default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select count(*)::integer
  from public.reputation_events e
  where e.user_id = p_user_id
    and e.voided_at is null
    and e.delta < 0
    and e.created_at > now() - make_interval(days => p_days)
    and (p_event_types is null or e.event_type = any (p_event_types));
$fn$;

-- ─── Writing to the ledger ───────────────────────────────────────────────────
--
-- Returns true when a row landed, false when this exact event was already
-- recorded. Callers in sweeps rely on that distinction: a false means a previous
-- pass already handled this offer and there is nothing to announce.
create or replace function public.record_reputation_event(
  p_user_id uuid,
  p_role text,
  p_event_type text,
  p_order_id uuid default null,
  p_offer_id uuid default null,
  p_card_id uuid default null,
  p_note text default null,
  p_actor_id text default null,
  p_actor_role text default null,
  p_delta integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_delta integer;
  v_rows integer;
begin
  if p_user_id is null or p_role is null or p_event_type is null then
    raise exception 'reputation_event_incomplete';
  end if;

  if p_event_type = 'admin_adjust' then
    -- The only event whose size is not fixed by the table above, so it is the
    -- only one that must say who is responsible for it.
    if p_delta is null then raise exception 'reputation_adjust_requires_delta'; end if;
    if p_actor_id is null or p_actor_role not in ('admin','moderator') then
      raise exception 'reputation_adjust_requires_actor';
    end if;
    v_delta := p_delta;
  else
    v_delta := public.reputation_delta(p_event_type, p_role);
  end if;

  insert into public.reputation_events (
    user_id, role, event_type, delta, order_id, offer_id, card_id, note,
    created_by, created_by_role
  ) values (
    p_user_id, p_role, p_event_type, v_delta, p_order_id, p_offer_id, p_card_id,
    p_note, p_actor_id, p_actor_role
  )
  -- Bare, so it catches either partial unique index without having to restate
  -- the predicate at every call site.
  on conflict do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  perform public.recompute_reputation(p_user_id);
  return true;
end;
$fn$;

-- Undo, for the case this whole design exists to make survivable: a penalty
-- applied for something that was not the person's fault. The row stays so the
-- correction is itself auditable.
create or replace function public.void_reputation_event(
  p_event_id uuid,
  p_reason text,
  p_actor_id text,
  p_actor_role text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid;
begin
  -- Same gate as set_account_restriction: reachable only through the service
  -- role, and only ever on behalf of a named admin or moderator.
  if auth.role() is distinct from 'service_role'
     or p_actor_id is null or p_actor_role not in ('admin','moderator') then
    raise exception 'forbidden';
  end if;

  update public.reputation_events
  set voided_at = now(),
      voided_by = p_actor_id,
      voided_by_role = p_actor_role,
      note = coalesce(note || ' | ', '') || 'voided: ' || coalesce(p_reason, 'no reason given')
  where id = p_event_id and voided_at is null
  returning user_id into v_user;

  if v_user is null then return false; end if;

  perform public.recompute_reputation(v_user);
  return true;
end;
$fn$;

revoke all on function public.reputation_delta(text, text) from public, anon;
grant execute on function public.reputation_delta(text, text) to authenticated, service_role;
revoke all on function public.recompute_reputation(uuid) from public, anon, authenticated;
grant execute on function public.recompute_reputation(uuid) to service_role;
revoke all on function public.recent_incident_count(uuid, integer, text[]) from public, anon;
grant execute on function public.recent_incident_count(uuid, integer, text[]) to authenticated, service_role;
revoke all on function public.record_reputation_event(uuid, text, text, uuid, uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_reputation_event(uuid, text, text, uuid, uuid, uuid, text, text, text, integer)
  to service_role;
revoke all on function public.void_reputation_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.void_reputation_event(uuid, text, text, text) to service_role;

-- ─── Backfill ────────────────────────────────────────────────────────────────
--
-- Only the positive half. Every order that reached `completed` is a fact still
-- on record, so those points can be reconstructed exactly. Penalties cannot:
-- `legit_rate` is a running total with no history behind it, so there is no way
-- to tell a buyer docked once from one docked four times, and 20260904000100
-- established that some of those decrements were wrong anyway. Backfilling
-- guesses would put people in the ⚠️ band for incidents nobody can point to.
--
-- Consequence worth stating: a long-standing seller starts with their real
-- order count and a clean sheet. That is the right direction to be wrong in.
do $do$
declare
  v_batch integer;
begin
  loop
    with batch as (
      select o.id, o.buyer_id, o.seller_id, o.card_id
      from public.orders o
      where o.status = 'completed'
        and not exists (
          select 1 from public.reputation_events e
          where e.order_id = o.id and e.event_type = 'order_completed'
        )
      limit 2000
    ),
    inserted as (
      insert into public.reputation_events (user_id, role, event_type, delta, order_id, card_id, note)
      select b.buyer_id, 'buyer', 'order_completed', 1, b.id, b.card_id, 'backfill'
      from batch b
      union all
      select b.seller_id, 'seller', 'order_completed', 1, b.id, b.card_id, 'backfill'
      from batch b
      on conflict do nothing
      returning 1
    )
    select count(*) into v_batch from inserted;

    exit when v_batch = 0;
  end loop;
end;
$do$;

-- One pass over everyone who ended up with a ledger, rather than recomputing per
-- inserted row inside the loop above.
update public.profiles p
set reputation_score = coalesce(agg.score, 0),
    reputation_incidents_90d = coalesce(agg.incidents, 0),
    reputation_incidents_total = coalesce(agg.incidents_total, 0)
from (
  select
    e.user_id,
    sum(e.delta) as score,
    count(*) filter (where e.delta < 0 and e.created_at > now() - interval '90 days') as incidents,
    count(*) filter (where e.delta < 0) as incidents_total
  from public.reputation_events e
  where e.voided_at is null
  group by e.user_id
) agg
where p.id = agg.user_id;

-- ─── Keeping the ninety-day window honest ────────────────────────────────────
--
-- `reputation_incidents_90d` decays with time, not with writes: the day an old
-- incident falls out of the window nothing happens to that row, so nothing
-- recomputes and the ⚠️ badge would stick forever. A nightly pass over the few
-- hundred people who could possibly have changed fixes that.
create or replace function public.recompute_stale_reputation_windows()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
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

  return v_count;
end;
$fn$;

revoke all on function public.recompute_stale_reputation_windows() from public, anon, authenticated, service_role;

-- pg_cron has no session, so auth.uid()/auth.role() are null inside the job.
-- Same wrapper shape as cron_release_delivered_orders (20260905000600).
create or replace function public.cron_recompute_reputation_windows()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.recompute_stale_reputation_windows();
end;
$fn$;

revoke all on function public.cron_recompute_reputation_windows() from public, anon, authenticated, service_role;

create extension if not exists pg_cron;

select cron.unschedule('recompute-reputation-windows')
where exists (select 1 from cron.job where jobname = 'recompute-reputation-windows');

-- 03:11 rather than the top of the hour: the window only moves once a day, and
-- off-peak keeps it away from the two-minute offer sweep.
select cron.schedule(
  'recompute-reputation-windows',
  '11 3 * * *',
  $job$select public.cron_recompute_reputation_windows()$job$
);

notify pgrst, 'reload schema';
