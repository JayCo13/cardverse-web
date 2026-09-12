-- Bring stored shop shipping in line with what the app can still charge.
--
-- Three things changed in the code on 2026-09-11 and left the tables behind:
--
--   1. VNPost, BEST Express and hand delivery (`self`) were retired
--      (`offerable: false` in src/lib/shipping-carriers.ts). Viettel Post
--      (`vtp`) went earlier. Rows still carry those codes; the app filters
--      them on every read, which works but hides a save that silently drops
--      them and makes every debugging session start by re-deriving that.
--
--   2. A fee cell now has to sit in 20,000–50,000đ (SHOP_TIER_FEE_MIN/MAX in
--      src/lib/shipping-fee.ts) and an absent cell means DEFAULT_SHOP_TIER_FEES
--      (20/22/25k). `shopFeeCell` already refuses to charge a cell outside that
--      band, so stored 15,000đ and 11,000đ cells are numbers nobody is billed
--      and nobody can see — dead weight that reads like live config.
--
--   3. Because an absent cell is now a real price, the listing gate below is
--      wrong: it demands nine numbers before a seller may list anything. Under
--      the new model a shop that has never opened the shipping page already has
--      a complete price list, and the gate would block exactly the sellers the
--      defaults were built for. Steps 1 and 2 would make it bite immediately.
--
-- Idempotent: re-running changes nothing. Nothing here touches a placed order —
-- orders keep the fee and carrier they were charged at, hand delivery included.

begin;

-- ── 1. Carriers: keep only the ones a seller could still pick today ─────────
update public.profiles
set shipping_carriers = coalesce((
  select array_agg(code order by ord)
  from unnest(shipping_carriers) with ordinality as u(code, ord)
  where code in ('ghn', 'shopee', 'jnt')
), '{}'::text[])
where shipping_carriers && array['self', 'vnp', 'vtp', 'best']::text[];

-- A shop left with an empty list is not a shop that cannot ship: both
-- offeredCarriers (verified-shipping.ts) and shopShippingRange read an empty
-- list as "no preference" and quote every courier at the default prices.

-- ── 2. Fees: drop retired carriers' rows and cells outside the band ─────────
--
-- Every numeric test sits inside a CASE guarded by jsonb_typeof. SQL does not
-- promise to evaluate an AND chain left to right, so a bare cast next to a type
-- check is a cast that can still run on a string and abort the migration.
update public.profiles p
set shipping_fees = coalesce((
  select jsonb_object_agg(carrier, cells)
  from (
    select
      c.key as carrier,
      (
        select jsonb_object_agg(t.key, t.value)
        from jsonb_each(c.value) t
        where t.key in ('intra', 'inter', 'region')
          and case
                when jsonb_typeof(t.value) = 'number'
                then (t.value #>> '{}')::numeric between 20000 and 50000
                 and (t.value #>> '{}')::numeric = trunc((t.value #>> '{}')::numeric)
                else false
              end
      ) as cells
    from jsonb_each(p.shipping_fees) c
    where c.key in ('ghn', 'shopee', 'jnt')
      and jsonb_typeof(c.value) = 'object'
  ) kept
  where cells is not null and cells <> '{}'::jsonb
), '{}'::jsonb)
where p.shipping_fees is not null
  and p.shipping_fees <> '{}'::jsonb
  and exists (
    select 1
    from jsonb_each(p.shipping_fees) c
    left join lateral (
      select t.key, t.value
      from jsonb_each(c.value) t
      where jsonb_typeof(c.value) = 'object'
    ) t on true
    where c.key not in ('ghn', 'shopee', 'jnt')
       or jsonb_typeof(c.value) <> 'object'
       or t.key is null
       or t.key not in ('intra', 'inter', 'region')
       or case
            when jsonb_typeof(t.value) = 'number'
            then (t.value #>> '{}')::numeric not between 20000 and 50000
              or (t.value #>> '{}')::numeric <> trunc((t.value #>> '{}')::numeric)
            else true
          end
  );

-- ── 3. The listing gate: stop demanding nine numbers ───────────────────────
--
-- Patched by rewriting the live definition, the same way the district clause
-- was patched in 20260907000100, and loud if the text has drifted since.
-- `missing_shipping_config` can no longer be raised: every shop has a complete
-- price list by construction, so the only shipping prerequisite left for a
-- listing is the pickup address, which the clause above this one still checks.
do $$
declare
  v_fn regprocedure := to_regprocedure('public.create_marketplace_listing(uuid,text,jsonb)');
  v_def text;
  v_old constant text :=
$old$  if not exists (
    select 1
    from unnest(coalesce(v_profile.shipping_carriers, '{}'::text[])) carrier
    where carrier <> 'self'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'intra') = 'number'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'inter') = 'number'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'region') = 'number'
      and (v_profile.shipping_fees -> carrier ->> 'intra')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'inter')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'region')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'intra')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'intra')::numeric)
      and (v_profile.shipping_fees -> carrier ->> 'inter')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'inter')::numeric)
      and (v_profile.shipping_fees -> carrier ->> 'region')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'region')::numeric)
  ) then
    raise exception 'missing_shipping_config';
  end if;
$old$;
  v_new constant text :=
$new$  -- Shipping config is no longer a listing prerequisite: an unset cell is
  -- DEFAULT_SHOP_TIER_FEES and an empty carrier list means every courier, so
  -- there is no shop a buyer cannot be quoted for. The pickup address check
  -- above remains, because a parcel still has to be collected from somewhere.
$new$;
begin
  if v_fn is null then
    raise exception 'create_marketplace_listing was not found';
  end if;

  select pg_get_functiondef(v_fn::oid) into v_def;

  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  elsif position('missing_shipping_config' in v_def) > 0 then
    raise exception 'create_marketplace_listing shipping check has drifted; patch it by hand';
  end if;
end
$$;

commit;

-- ── Check what it did ──────────────────────────────────────────────────────
-- select display_name, shipping_carriers, shipping_fees
-- from public.profiles
-- where shipping_carriers <> '{}'::text[] or shipping_fees <> '{}'::jsonb
-- order by display_name;
--
-- Nothing should come back from either of these:
--
-- select id from public.profiles where shipping_carriers && array['self','vnp','vtp','best']::text[];
-- select p.id, c.key, t.key, t.value
-- from public.profiles p, jsonb_each(p.shipping_fees) c, jsonb_each(c.value) t
-- where c.key not in ('ghn','shopee','jnt')
--    or jsonb_typeof(t.value) <> 'number'
--    or (t.value #>> '{}')::numeric not between 20000 and 50000;

-- ── Optional: wipe one shop's shipping setup to test the first-run flow ─────
--
-- Read the trigger note before running this. `trg_sync_pickup_address_to_default`
-- copies profiles.address_* onto the user's DEFAULT RECEIVING address in
-- shipping_addresses, so nulling those columns with the trigger live would blank
-- the address they buy with — not just the one they ship from. Disable it for
-- the statement, or leave the address_* columns alone.
--
-- Put your own email in. Nothing here touches placed orders.
--
-- alter table public.profiles disable trigger trg_sync_pickup_address_to_default;
--
-- update public.profiles
-- set shipping_carriers = '{}'::text[],
--     shipping_fees = '{}'::jsonb,
--     goship_pickup = null,
--     goship_tier_fees = null,
--     goship_tier_fees_at = null,
--     address_province_id = null,
--     address_province_name = null,
--     address_ward_code = null,
--     address_ward_name = null,
--     address_detail = null
-- where id = (select id from auth.users where email = 'thanhnha6f@gmail.com');
--
-- alter table public.profiles enable trigger trg_sync_pickup_address_to_default;
--
-- To reset ONLY the price list and keep the pickup address, run the update with
-- just the first three columns and skip both alter statements.
