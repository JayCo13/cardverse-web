-- Reserve "CardVerse" / "CardVerseHub" as a display name.
--
-- There is exactly one official storefront account ("CardVerseHub - Seller").
-- Any other profile named CardVerse in any spelling — "Card Verse",
-- "card-verse-hub", "CARDVERSE99" — reads as the platform itself, so the
-- name is refused at the table, not just in the form: profiles.display_name
-- is written straight from the browser (signup insert, /profile/edit update,
-- ensureProfile upsert) and by handle_new_user for Google sign-ups.
--
--   * UPDATE to a reserved name  -> raises display_name_reserved (form shows it)
--   * INSERT with a reserved name -> silently falls back to the email local
--     part (a Google account whose full name is "CardVerse ..." must still be
--     able to sign up; handle_new_user swallows errors and would otherwise
--     leave the user with no profile row at all)
--
-- The official account is exempt by email domain. A row that already carries
-- the name and is not being renamed is left alone (the check runs only when
-- display_name actually changes), so the existing official row is untouched.

create or replace function public.is_reserved_display_name(p_name text)
returns boolean
language sql
immutable
as $$
  select p_name is not null
     and regexp_replace(lower(p_name), '[^a-z0-9]', '', 'g') like '%cardverse%';
$$;

create or replace function public.profiles_reserve_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fallback text;
begin
  if not public.is_reserved_display_name(new.display_name) then
    return new;
  end if;

  -- The platform's own accounts may use the name.
  if lower(coalesce(new.email, '')) like '%@cardversehub.com' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.display_name is not distinct from old.display_name then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'display_name_reserved'
      using errcode = 'check_violation',
            hint = 'CardVerse / CardVerseHub is reserved for the official account.';
  end if;

  -- INSERT: keep the account, drop the name.
  v_fallback := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  if v_fallback is null or public.is_reserved_display_name(v_fallback) then
    v_fallback := 'user_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  new.display_name := v_fallback;
  return new;
end;
$$;

drop trigger if exists profiles_reserve_display_name on public.profiles;
create trigger profiles_reserve_display_name
  before insert or update of display_name on public.profiles
  for each row execute function public.profiles_reserve_display_name();
