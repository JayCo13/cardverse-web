-- Make refresh_pokemon_views() survive the anon/authenticated statement
-- timeout (~8s). Refreshing the Pokémon materialized views takes longer than
-- that, so the RPC call from the crawler was being cancelled
-- ("canceling statement due to statement timeout").
--
-- Fix: SECURITY DEFINER (runs as the function owner, e.g. postgres) +
-- statement_timeout = 0 (no limit) inside the function. Each matview is
-- refreshed only if it exists, so this is safe regardless of which views
-- are present.

create or replace function refresh_pokemon_views()
returns void
language plpgsql
security definer
set statement_timeout = 0
set search_path = public
as $$
declare
    v text;
begin
    foreach v in array array[
        'pokemon_sets_en',
        'pokemon_sets_jp',
        'featured_pokemon_cards',
        'featured_pokemon_cards_jp'
    ]
    loop
        if exists (
            select 1 from pg_matviews
            where schemaname = 'public' and matviewname = v
        ) then
            execute format('refresh materialized view %I', v);
        end if;
    end loop;
end;
$$;

grant execute on function refresh_pokemon_views() to anon, authenticated, service_role;
