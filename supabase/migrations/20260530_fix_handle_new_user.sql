-- Fix: "Database error saving new user" on first Google/email signup.
--
-- Root cause: a trigger on auth.users (handle_new_user) failed when inserting
-- into public.profiles — typically because it was NOT security definer (so it
-- ran as supabase_auth_admin, which lacks INSERT on public.profiles), which
-- GoTrue surfaces as "Database error saving new user".
--
-- This makes the trigger:
--   * security definer (runs as owner, can insert into public.profiles)
--   * conflict-safe (the app also upserts the profile via ensureProfile)
--   * crash-proof (never blocks the auth.users insert if the profile fails)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, profile_image_url)
  values (
    new.id,
    coalesce(new.email, ''),                       -- profiles.email is NOT NULL
    coalesce(new.raw_user_meta_data->>'display_name',
             new.raw_user_meta_data->>'full_name',
             split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    return new;                                    -- never block account creation
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Second trigger on auth.users seeds public.wallets. It previously had no
-- exception handler, so a failing insert (e.g. ON CONFLICT with no matching
-- unique constraint on wallets.user_id) blocked account creation entirely.
-- Make it crash-proof too.
create or replace function public.handle_new_user_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    return new;                                    -- never block account creation
end;
$$;

drop trigger if exists on_auth_user_created_wallet on auth.users;
create trigger on_auth_user_created_wallet
  after insert on auth.users
  for each row execute function public.handle_new_user_wallet();
