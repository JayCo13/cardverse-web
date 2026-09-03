-- Run after all migrations against an isolated database.
begin;

do $$
declare
  u_seller uuid := '76000000-0000-4000-8000-000000000001';
  u_buyer uuid := '76000000-0000-4000-8000-000000000002';
  request_key uuid := '76000000-0000-4000-8000-000000000003';
  second_key uuid := '76000000-0000-4000-8000-000000000004';
  payload jsonb := jsonb_build_object(
    'name', 'Idempotent listing',
    'description', repeat('A', 120),
    'listing_type', 'sale',
    'category', 'sports',
    'condition', 'Near Mint',
    'image_url', 'https://example.test/card.jpg',
    'image_urls', jsonb_build_array('https://example.test/card.jpg'),
    'quantity', 1,
    'price', 100000,
    'accept_offers', true,
    'min_offer_percent', 80,
    'is_bundle', false
  );
  first_result jsonb;
  replay_result jsonb;
  second_result jsonb;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_seller, 'listing-seller@example.test'),
    (u_buyer, 'listing-buyer@example.test');
  insert into public.profiles (
    id, email, address_district_id, address_ward_code, shipping_carriers, shipping_fees
  ) values (
    u_seller, 'listing-seller@example.test', 1, '001', array['ghn'],
    '{"ghn":{"intra":20000,"inter":30000,"region":40000}}'::jsonb
  ), (
    u_buyer, 'listing-buyer@example.test', 1, '001', '{}'::text[], '{}'::jsonb
  );
  insert into public.seller_verifications (
    user_id, full_name, id_card_front_url, id_card_back_url, selfie_url,
    bank_name, bank_account_number, bank_account_name, status
  ) values (
    u_seller, 'Listing Seller', 'front', 'back', 'selfie',
    'Bank', '123456789', 'LISTING SELLER', 'approved'
  );

  perform set_config('request.jwt.claim.sub', u_seller::text, true);
  first_result := public.create_marketplace_listing(request_key, repeat('a', 64), payload);
  replay_result := public.create_marketplace_listing(request_key, repeat('a', 64), payload);
  assert first_result ->> 'cardId' = replay_result ->> 'cardId';
  assert not (first_result ->> 'replayed')::boolean;
  assert (replay_result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.cards where seller_id = u_seller);

  failed := false;
  begin
    perform public.create_marketplace_listing(request_key, repeat('b', 64), payload || '{"price":110000}'::jsonb);
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'a reused key accepted different listing content';

  -- Identical physical cards remain valid when the seller explicitly starts a
  -- new submission with a different key.
  second_result := public.create_marketplace_listing(second_key, repeat('c', 64), payload);
  assert second_result ->> 'cardId' <> first_result ->> 'cardId';
  assert (select count(*) = 2 from public.cards where seller_id = u_seller);

  perform public.update_own_sale_listing(
    (first_result ->> 'cardId')::uuid, 'Updated listing title', repeat('B', 120),
    120000, true, 75
  );
  assert (select price = 120000 from public.cards where id = (first_result ->> 'cardId')::uuid);

  insert into public.offers (card_id, buyer_id, price, status)
  values ((first_result ->> 'cardId')::uuid, u_buyer, 100000, 'pending');
  failed := false;
  begin
    perform public.update_own_sale_listing(
      (first_result ->> 'cardId')::uuid, 'Updated listing title', repeat('B', 120),
      130000, true, 75
    );
  exception when others then failed := sqlerrm = 'open_offers_locked'; end;
  assert failed, 'commercial terms changed while an offer was open';

  -- Content-only edits are still allowed while the commercial terms are held.
  perform public.update_own_sale_listing(
    (first_result ->> 'cardId')::uuid, 'Content-only update', repeat('C', 120),
    120000, true, 75
  );
end;
$$;

rollback;
