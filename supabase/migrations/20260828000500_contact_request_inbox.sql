-- Persist contact form submissions for the admin inbox. The consumer browser
-- never receives direct table access; the server API validates and calls the
-- RPC below with the service-role key.
create table if not exists public.contact_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    name text not null check (char_length(name) between 2 and 100),
    email text not null check (char_length(email) between 3 and 254),
    subject text not null check (char_length(subject) between 3 and 160),
    message text not null check (char_length(message) between 10 and 4000),
    status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
    -- Hashes are used only for rate limiting. Never retain the submitter IP.
    email_hash text not null,
    ip_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists contact_requests_status_created_at_idx
    on public.contact_requests (status, created_at desc);
create index if not exists contact_requests_email_hash_created_at_idx
    on public.contact_requests (email_hash, created_at desc);
create index if not exists contact_requests_ip_hash_created_at_idx
    on public.contact_requests (ip_hash, created_at desc);

alter table public.contact_requests enable row level security;

-- API routes use the service role. This policy only permits Supabase-authenticated
-- admins to receive realtime changes; regular users cannot read support tickets.
drop policy if exists "Admins can read contact requests" on public.contact_requests;
create policy "Admins can read contact requests"
    on public.contact_requests
    for select
    to authenticated
    using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- The advisory locks make the three submissions/hour cap atomic across
-- concurrent requests. Both the normalized email and hashed IP are capped.
create or replace function public.create_contact_request(
    p_user_id uuid,
    p_name text,
    p_email text,
    p_subject text,
    p_message text,
    p_email_hash text,
    p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.contact_requests;
    v_recent_count integer;
begin
    perform pg_advisory_xact_lock(hashtextextended('contact-email:' || p_email_hash, 0));
    perform pg_advisory_xact_lock(hashtextextended('contact-ip:' || p_ip_hash, 0));

    select count(*)
    into v_recent_count
    from public.contact_requests
    where created_at >= now() - interval '1 hour'
      and (email_hash = p_email_hash or ip_hash = p_ip_hash);

    if v_recent_count >= 3 then
        return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;

    insert into public.contact_requests (
        user_id, name, email, subject, message, email_hash, ip_hash
    ) values (
        p_user_id, p_name, p_email, p_subject, p_message, p_email_hash, p_ip_hash
    ) returning * into v_request;

    return jsonb_build_object('ok', true, 'id', v_request.id);
end;
$$;

revoke all on function public.create_contact_request(uuid, text, text, text, text, text, text) from public;
grant execute on function public.create_contact_request(uuid, text, text, text, text, text, text) to service_role;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'contact_requests'
    ) then
        alter publication supabase_realtime add table public.contact_requests;
    end if;
end;
$$;

notify pgrst, 'reload schema';
