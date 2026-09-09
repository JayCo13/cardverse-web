-- Stop requiring a fee table that no longer prices anything.
--
-- Listing was gated on the seller having filled three fees for a carrier —
-- nội tỉnh, ngoại tỉnh, liên miền. Measured against GoShip, that structure
-- describes nothing real: a 200g card costs 15,385–15,700đ to send whether it
-- goes across Ho Chi Minh City or to Hanoi. Distance does not move the price at
-- this weight, so three tiers of guesses produced numbers unrelated to cost —
-- one seller's 11,000đ was below the floor and lost money on every order.
--
-- Shipping is a flat platform price now, quoted server-side, so there is
-- nothing for a seller to fill in and nothing here to check. The pickup address
-- check above stays: a parcel still has to be collected from somewhere, and
-- that one is about reality rather than a price list.
--
-- The block is cut out of the live definition rather than the whole body being
-- restated, the same way 20260906000400 removed the district requirement.
-- Restating 200 lines to delete twenty is how the other 180 drift.

do $$
declare
  v_def text;
  v_new text;
  v_block constant text :=
'  if not exists (
    select 1
    from unnest(coalesce(v_profile.shipping_carriers, ''{}''::text[])) carrier
    where carrier <> ''self''
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> ''intra'') = ''number''
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> ''inter'') = ''number''
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> ''region'') = ''number''
      and (v_profile.shipping_fees -> carrier ->> ''intra'')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> ''inter'')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> ''region'')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> ''intra'')::numeric = trunc((v_profile.shipping_fees -> carrier ->> ''intra'')::numeric)
      and (v_profile.shipping_fees -> carrier ->> ''inter'')::numeric = trunc((v_profile.shipping_fees -> carrier ->> ''inter'')::numeric)
      and (v_profile.shipping_fees -> carrier ->> ''region'')::numeric = trunc((v_profile.shipping_fees -> carrier ->> ''region'')::numeric)
  ) then
    raise exception ''missing_shipping_config'';
  end if;
';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_marketplace_listing';

  if position(v_block in v_def) = 0 then
    raise exception 'the shipping-tier gate is not where this migration expects it; check by hand before assuming listing is unblocked';
  end if;

  v_new := replace(v_def, v_block, '');
  execute v_new;
end
$$;

-- Called, not merely created: a seller with no fee table must now be able to
-- list. This asserts the gate is gone rather than trusting the replace.
do $$
begin
  if exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_marketplace_listing'
      and pg_get_functiondef(p.oid) like '%missing_shipping_config%'
  ) then
    raise exception 'missing_shipping_config is still raised; the gate was not removed';
  end if;
end
$$;
