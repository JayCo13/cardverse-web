-- Run after all migrations against an isolated database.  This deliberately
-- exercises inventory by exact JSON object/multiplicity, not title/price
-- deduplication.  Roll back so it can be replayed.
begin;

do $$
declare
  seller_id uuid := '70000000-0000-4000-8000-000000000001';
  buyer_id uuid := '70000000-0000-4000-8000-000000000002';
  card_id uuid := '70000000-0000-4000-8000-000000000003';
  restore_card_id uuid := '70000000-0000-4000-8000-000000000004';
  restore_order_id uuid := '70000000-0000-4000-8000-000000000005';
  reserved_order_id uuid := '70000000-0000-4000-8000-000000000006';
  item_a jsonb := jsonb_build_object('title', 'Duplicate card', 'price', 300000, 'serial', 'A');
  item_b jsonb := jsonb_build_object('title', 'Duplicate card', 'price', 300000, 'serial', 'B');
  item_c jsonb := jsonb_build_object('title', 'Other card', 'price', 300000, 'serial', 'C');
  result jsonb;
  failed boolean := false;
begin
  insert into auth.users (id, email) values
    (seller_id, 'bundle-seller@example.test'),
    (buyer_id, 'bundle-buyer@example.test');
  insert into public.profiles (id, email, display_name) values
    (seller_id, 'bundle-seller@example.test', 'Bundle seller'),
    (buyer_id, 'bundle-buyer@example.test', 'Bundle buyer')
  on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;

  -- Partial wallet/PayOS inventory updates historically only wrote
  -- bundle_items. The card trigger keeps quantity in lockstep.
  insert into public.cards (
    id, seller_id, name, category, listing_type, status, is_bundle,
    bundle_items, quantity
  ) values (
    card_id, seller_id, 'Partial bundle', 'sports', 'sale', 'active', true,
    jsonb_build_array(item_a, item_b), 2
  );
  update public.cards set bundle_items = jsonb_build_array(item_b) where id = card_id;
  assert (select quantity = 1 and jsonb_array_length(bundle_items) = 1
    from public.cards where id = card_id),
    'partial bundle purchase did not keep quantity in sync';

  failed := false;
  begin
    update public.cards set quantity = 2 where id = card_id;
  exception when others then failed := sqlerrm = 'bundle_quantity_mismatch';
  end;
  assert failed, 'database accepted an explicit bundle quantity mismatch';

  -- A full purchase ends with no remaining bundle items and quantity zero.
  update public.cards set status = 'sold' where id = card_id;
  assert (select quantity = 0 and bundle_items = '[]'::jsonb
    from public.cards where id = card_id),
    'full bundle purchase did not clear inventory';

  -- Two cards sharing title/price are still two physical entries. Restoring a
  -- paid selection returns both once, and replaying does not append them again.
  insert into public.cards (
    id, seller_id, name, category, listing_type, status, is_bundle,
    bundle_items, quantity
  ) values (
    restore_card_id, seller_id, 'Restore bundle', 'sports', 'sale', 'active', true,
    jsonb_build_array(item_c), 1
  );
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid, payment_method,
    status, metadata
  ) values (
    restore_order_id, restore_card_id, seller_id, buyer_id, 600000, 600000,
    'wallet', 'cancelled', jsonb_build_object(
      'bundle_selection', jsonb_build_array(item_a, item_b),
      'bundle_items_before', jsonb_build_array(item_a, item_b, item_c),
      'bundle_inventory_state', 'subtracted'
    )
  );
  result := public.restore_bundle_order_inventory(restore_order_id);
  assert not coalesce((result ->> 'replayed')::boolean, false);
  assert (select quantity = 3 and jsonb_array_length(bundle_items) = 3
    from public.cards where id = restore_card_id),
    'refund did not restore the exact two-card selection';
  result := public.restore_bundle_order_inventory(restore_order_id);
  assert (result ->> 'replayed')::boolean;
  assert (select quantity = 3 and jsonb_array_length(bundle_items) = 3
    from public.cards where id = restore_card_id),
    'replayed refund restored the selection twice';

  -- A pre-payment cancellation has never subtracted inventory and is therefore
  -- never eligible for a restore.
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid, payment_method,
    status, metadata
  ) values (
    reserved_order_id, restore_card_id, seller_id, buyer_id, 300000, 300000,
    'direct_payos', 'cancelled', jsonb_build_object(
      'bundle_selection', jsonb_build_array(item_a),
      'bundle_items_before', jsonb_build_array(item_a, item_b, item_c),
      'bundle_inventory_state', 'reserved'
    )
  );
  failed := false;
  begin
    perform public.restore_bundle_order_inventory(reserved_order_id);
  exception when others then failed := sqlerrm = 'bundle_restore_not_eligible';
  end;
  assert failed, 'pre-payment cancellation restored inventory that was never removed';
end;
$$;

rollback;
