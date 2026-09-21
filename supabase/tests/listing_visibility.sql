-- Run after all migrations against an isolated database.
begin;

do $$
declare
  u_seller uuid := '77000000-0000-4000-8000-000000000001';
  u_buyer uuid := '77000000-0000-4000-8000-000000000002';
  listing_id uuid := '77000000-0000-4000-8000-000000000003';
  locked_id uuid := '77000000-0000-4000-8000-000000000004';
  seeded_offer_id uuid := '77000000-0000-4000-8000-000000000005';
  result jsonb;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_seller, 'visibility-seller@example.test'),
    (u_buyer, 'visibility-buyer@example.test');
  insert into public.profiles (id, email) values
    (u_seller, 'visibility-seller@example.test'),
    (u_buyer, 'visibility-buyer@example.test');
  insert into public.seller_verifications (
    user_id, full_name, id_card_front_url, id_card_back_url, selfie_url,
    bank_name, bank_account_number, bank_account_name, status
  ) values (
    u_seller, 'Visibility Seller', 'front', 'back', 'selfie',
    'Bank', '987654321', 'VISIBILITY SELLER', 'approved'
  );
  insert into public.cards (
    id, seller_id, name, category, listing_type, price, description,
    status, accept_offers, min_offer_percent
  ) values
    (listing_id, u_seller, 'Visibility listing', 'Pokemon', 'sale', 100000,
      repeat('A', 120), 'active', true, 80),
    (locked_id, u_seller, 'Locked visibility listing', 'Pokemon', 'sale', 100000,
      repeat('B', 120), 'active', true, 80);
  insert into public.offers (id, card_id, buyer_id, price, status)
  values (seeded_offer_id, listing_id, u_buyer, 90000, 'pending');
  insert into public.cart_items (user_id, card_id, quantity)
  values (u_buyer, listing_id, 1);

  perform set_config('request.jwt.claim.sub', u_seller::text, true);
  result := public.manage_own_listing(listing_id, 'hide');
  assert result ->> 'visibility' = 'hidden';
  assert (result ->> 'rejectedOfferCount')::integer = 1;
  assert (select listing_visibility = 'hidden' and hidden_at is not null
    from public.cards where id = listing_id);
  assert (select o.status = 'rejected' from public.offers o where o.id = seeded_offer_id);
  assert not exists (select 1 from public.cart_items where card_id = listing_id);
  assert (select count(*) = 1 from public.notifications n
    where n.offer_id = seeded_offer_id and n.type = 'offer_rejected'
      and n.metadata ->> 'event' = 'listing_hidden');

  -- Replays do not emit a second notification.
  result := public.manage_own_listing(listing_id, 'hide');
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.notifications n
    where n.offer_id = seeded_offer_id and n.type = 'offer_rejected');

  perform set_config('request.jwt.claim.sub', u_buyer::text, true);
  failed := false;
  begin
    insert into public.offers (card_id, buyer_id, price, status)
    values (listing_id, u_buyer, 95000, 'pending');
  exception when others then failed := sqlerrm = 'listing_hidden'; end;
  assert failed, 'a hidden listing accepted a new offer';
  failed := false;
  begin
    insert into public.cart_items (user_id, card_id, quantity)
    values (u_buyer, listing_id, 1);
  exception when others then failed := sqlerrm = 'listing_hidden'; end;
  assert failed, 'a hidden listing was added back to a cart';
  perform set_config('request.jwt.claim.sub', u_seller::text, true);

  -- Content remains editable while hidden.
  perform public.update_own_sale_listing(
    listing_id, 'Edited hidden listing', repeat('C', 120), 110000, true, 80
  );
  assert (select name = 'Edited hidden listing' from public.cards where id = listing_id);

  failed := false;
  begin
    update public.cards set listing_visibility = 'visible' where id = listing_id;
  exception when others then failed := sqlerrm = 'listing_visibility_rpc_required'; end;
  assert failed, 'direct visibility update bypassed the management RPC';

  result := public.manage_own_listing(listing_id, 'restore');
  assert result ->> 'visibility' = 'visible';
  assert (select listing_visibility = 'visible' and hidden_at is null
    from public.cards where id = listing_id);

  -- A selected/held offer prevents hiding.
  insert into public.offers (card_id, buyer_id, price, status)
  values (locked_id, u_buyer, 90000, 'chosen');
  failed := false;
  begin
    perform public.manage_own_listing(locked_id, 'hide');
  exception when others then failed := sqlerrm = 'listing_transaction_locked'; end;
  assert failed, 'listing with a chosen offer was hidden';

  -- Hide again, then soft-delete. Historical offer rows remain.
  result := public.manage_own_listing(listing_id, 'hide');
  result := public.manage_own_listing(listing_id, 'delete');
  assert result ->> 'visibility' = 'deleted';
  assert (select listing_visibility = 'deleted' and deleted_at is not null
    from public.cards where id = listing_id);
  assert exists (select 1 from public.offers o where o.id = seeded_offer_id);

  failed := false;
  begin
    perform public.update_own_sale_listing(
      listing_id, 'Deleted listing edit', repeat('D', 120), 120000, true, 80
    );
  exception when others then failed := sqlerrm = 'listing_deleted'; end;
  assert failed, 'soft-deleted listing remained editable';

  perform set_config('request.jwt.claim.sub', u_buyer::text, true);
  failed := false;
  begin
    perform public.manage_own_listing(locked_id, 'hide');
  exception when others then failed := sqlerrm = 'listing_not_found'; end;
  assert failed, 'another user managed the seller listing';
end;
$$;

rollback;
