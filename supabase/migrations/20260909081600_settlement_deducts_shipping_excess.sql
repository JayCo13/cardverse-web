-- Pay the seller what they earned, less the shipping they chose to overspend.
--
-- Both settlement paths credited v_order.amount flat. They now credit
-- seller_payout_for(v_order), which subtracts only the part of the carrier bill
-- that exceeded what the buyer paid for shipping.
--
-- The audit fields move with the credit. A log that reports a payout the wallet
-- did not receive is worse than no log: it is the number an argument would be
-- settled by.
--
-- Buyer refunds are untouched. Those pay back total_paid, shipping included,
-- because a buyer who does not get their card should not be charged to have it
-- not arrive.
--
-- Cut out of the live definitions rather than restating them, the same way
-- 20260906000400 removed the district requirement.

do $$
declare
  v_fn text;
  v_def text;
  v_new text;
  v_changed int := 0;
  v_credit constant text := 'v_order.seller_id, v_order.amount, ''marketplace_sale'',';
  v_audit  constant text := '''seller_payout'', v_order.amount';
begin
  for v_fn, v_def in
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('complete_verified_marketplace_order', 'resolve_marketplace_dispute')
  loop
    v_new := replace(v_def, v_credit,
      'v_order.seller_id, public.seller_payout_for(v_order), ''marketplace_sale'',');
    v_new := replace(v_new, v_audit,
      '''seller_payout'', public.seller_payout_for(v_order)');

    if v_new <> v_def then
      execute v_new;
      v_changed := v_changed + 1;
      raise notice 'settlement now nets shipping excess: %', v_fn;
    end if;
  end loop;

  -- Loud, not silent. Both functions carry one of those strings; if neither
  -- matched, the excess is still being absorbed by the platform while the
  -- booking screen tells sellers otherwise.
  if v_changed < 2 then
    raise exception 'expected to rewrite 2 settlement functions, rewrote %; check by hand', v_changed;
  end if;
end
$$;

-- Called, not merely created: proves the arithmetic on the three cases that
-- matter before a real order meets it.
do $$
declare
  v_order public.orders%rowtype;
begin
  v_order.amount := 800000;
  v_order.shipping_fee := 25000;

  v_order.goship_fee := 15700;   -- cheaper than collected: seller keeps nothing extra
  if public.seller_payout_for(v_order) <> 800000 then
    raise exception 'under budget should pay the full amount, got %', public.seller_payout_for(v_order);
  end if;

  v_order.goship_fee := 35125;   -- dearer: the 10,125đ over is the seller's
  if public.seller_payout_for(v_order) <> 789875 then
    raise exception 'over budget should net the excess, got %', public.seller_payout_for(v_order);
  end if;

  v_order.goship_fee := null;    -- never booked through us
  if public.seller_payout_for(v_order) <> 800000 then
    raise exception 'an unbooked order should pay the full amount, got %', public.seller_payout_for(v_order);
  end if;

  v_order.amount := 10000;       -- a bill larger than the sale cannot go negative
  v_order.goship_fee := 40700;
  if public.seller_payout_for(v_order) <> 0 then
    raise exception 'payout must not go below zero, got %', public.seller_payout_for(v_order);
  end if;
end
$$;
