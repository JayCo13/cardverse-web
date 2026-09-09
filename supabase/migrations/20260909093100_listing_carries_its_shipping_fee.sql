-- Store the seller's shipping price when the listing is created.
--
-- Added to the live insert rather than restating 200 lines of function to add
-- one column, the same way 20260906000400 removed the district requirement.
--
-- The value is validated here, not only in the route: a whole number between
-- 0 and 99,999 đồng. Anything else is stored as null and falls back to the
-- platform default, because a listing must not fail to exist over a shipping
-- price, and must not quietly charge a buyer a number nobody checked.

do $$
declare
  v_def text;
  v_new text;
  v_cols constant text := 'is_bundle, bundle_items, price, current_bid, starting_bid, auction_ends,';
  v_vals constant text :=
'    case when v_listing_type = ''sale'' then (p_card ->> ''price'')::bigint else null end,';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_marketplace_listing';

  if position(v_cols in v_def) = 0 or position(v_vals in v_def) = 0 then
    raise exception 'the cards insert is not shaped as this migration expects; add shipping_fee by hand';
  end if;

  v_new := replace(v_def, v_cols,
    'is_bundle, bundle_items, shipping_fee, price, current_bid, starting_bid, auction_ends,');

  v_new := replace(v_new, v_vals,
'    case when jsonb_typeof(p_card -> ''shipping_fee'') = ''number''
           and (p_card ->> ''shipping_fee'')::numeric between 0 and 99999
           and (p_card ->> ''shipping_fee'')::numeric = trunc((p_card ->> ''shipping_fee'')::numeric)
      then (p_card ->> ''shipping_fee'')::integer else null end,
' || v_vals);

  execute v_new;
end
$$;

-- Called, not merely created. A listing insert that silently dropped the fee
-- would only show up as buyers being charged the default months later.
do $$
begin
  if (select count(*)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_marketplace_listing'
        and pg_get_functiondef(p.oid) like '%shipping_fee%') <> 1 then
    raise exception 'create_marketplace_listing does not carry shipping_fee';
  end if;
end
$$;
