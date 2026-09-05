-- Run the post-delivery sweep on a real schedule, inside the database.
--
-- It ran from page loads first, then from GitHub Actions. Actions works but its
-- cron is best-effort on free repositories: the declared half-hourly schedule
-- was actually firing every two to five hours. That was fine when the sweep only
-- escalated orders; it now releases escrow, and a seller should not wait on
-- GitHub's queue for money that is already theirs.
--
-- pg_cron also removes the whole round trip. complete_delivered_orders() is a
-- database function; calling it over HTTP meant a secret, a route, a deploy and
-- a network hop to reach something already sitting in the same database. The
-- route stays for manual runs, but nothing schedules it any more.

create extension if not exists pg_cron;

-- complete_delivered_orders() authorises via auth.role(), which reads
-- request.jwt.claims out of the PostgREST session. pg_cron has no session, so
-- auth.role() and auth.uid() both return null and the function refuses to run.
-- This sets the claim for the transaction, which is what a service-role request
-- would have carried anyway.
--
-- SECURITY DEFINER and callable by nobody but the scheduler: it is a way to run
-- the sweep with the auth check satisfied, so handing it to anon or
-- authenticated would hand them the sweep itself.
create or replace function public.cron_release_delivered_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settled integer;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_settled := public.complete_delivered_orders();
  return v_settled;
end;
$$;

revoke execute on function public.cron_release_delivered_orders() from public, anon, authenticated, service_role;

-- Every 15 minutes. The window it settles is 72h, so the interval only decides
-- how long past that a seller waits; a quarter of an hour is far below the
-- resolution anyone notices, and the sweep is a no-op when nothing is due.
select cron.unschedule('release-delivered-orders')
where exists (select 1 from cron.job where jobname = 'release-delivered-orders');

select cron.schedule(
  'release-delivered-orders',
  '*/15 * * * *',
  $job$select public.cron_release_delivered_orders()$job$
);
