-- Let the offer inbox say which kind of incident it is warning about.
--
-- The ⚠️ badge reads `profiles.reputation_incidents_90d`, which counts every
-- negative event on an account. In a seller's offer inbox that produces two
-- identical warnings for two unrelated facts: a buyer who has left three
-- accepted offers unpaid, and a seller whose only marks are sales they
-- cancelled — someone with a spotless record as a buyer. The seller is deciding
-- whether this person will pay, and the badge hides the only number that speaks
-- to it.
--
-- This is the same conflation 20260909000600 removed from the gate, still
-- present in the display. Since blocking became opt-in, that badge is the whole
-- of the automatic warning most sellers get, so it has to be about the right
-- thing.
--
-- Batched rather than one call per row: an inbox page renders ten offers and the
-- alternative is ten round trips.
--
-- Scoped, not open: it answers only for people who have actually offered on one
-- of the caller's own cards. Without that clause any signed-in account could
-- audit any other's payment history, which is the leak
-- `offer_restriction_until(p_user_id)` carried before it was dropped.
create or replace function public.buyer_incident_counts(p_user_ids uuid[])
returns table (user_id uuid, incidents integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    u.id,
    (
      select count(*)::integer
      from public.reputation_events e
      where e.user_id = u.id
        and e.voided_at is null
        and e.delta < 0
        -- The buyer-side conduct a seller is exposed to by accepting. Not
        -- `buyer_cancelled`: releasing the card early hands the queue straight
        -- back, and 20260909000600 already declined to count it against them.
        and e.event_type in ('offer_unpaid', 'buyer_fraud')
        and e.created_at > now() - interval '90 days'
    )
  from unnest(p_user_ids) as u(id)
  where exists (
    select 1
    from public.offers o
    join public.cards c on c.id = o.card_id
    where o.buyer_id = u.id and c.seller_id = auth.uid()
  );
$fn$;

revoke all on function public.buyer_incident_counts(uuid[]) from public, anon;
grant execute on function public.buyer_incident_counts(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
