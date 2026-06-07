  -- Secure KYC flow and seller listing enforcement

  create table if not exists public.kyc_verification_scans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    cccd_name text,
    cccd_id_number text,
    cccd_dob text,
    is_valid_cccd boolean not null default false,
    is_valid_cccd_back boolean not null default false,
    bank_account_name_ai text,
    bank_account_number_ai text,
    bank_name_detected text,
    is_valid_bank boolean not null default false,
    ai_name_match boolean not null default false,
    is_cccd_bank_match boolean not null default false,
    is_cccd_user_match boolean not null default false,
    confidence numeric(4, 2) not null default 0,
    issues jsonb,
    raw_front_response jsonb,
    raw_back_response jsonb,
    raw_bank_response jsonb,
    expires_at timestamp with time zone not null default (now() + interval '30 minutes'),
    used_at timestamp with time zone,
    created_at timestamp with time zone not null default now()
  );

  alter table public.kyc_verification_scans enable row level security;

  drop policy if exists "Users can view own kyc scans" on public.kyc_verification_scans;
  create policy "Users can view own kyc scans"
    on public.kyc_verification_scans for select to authenticated
    using (auth.uid() = user_id);

  drop policy if exists "Users can create own kyc scans" on public.kyc_verification_scans;
  create policy "Users can create own kyc scans"
    on public.kyc_verification_scans for insert to authenticated
    with check (auth.uid() = user_id);

  drop policy if exists "Users can update own kyc scans" on public.kyc_verification_scans;
  create policy "Users can update own kyc scans"
    on public.kyc_verification_scans for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  do $$
  begin
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'seller_verifications'
        and column_name = 'selfie_url'
    ) then
      execute 'alter table public.seller_verifications alter column selfie_url drop not null';
    end if;
  end
  $$;

  alter table public.seller_verifications
    drop column if exists selfie_url,
    add column if not exists bank_screenshot_url text,
    add column if not exists phone_number text,
    add column if not exists ai_cccd_name text,
    add column if not exists ai_bank_name text,
    add column if not exists ai_bank_number text,
    add column if not exists ai_confidence numeric(4, 2),
    add column if not exists ai_name_match boolean,
    add column if not exists ai_scan_id uuid references public.kyc_verification_scans(id) on delete set null,
    add column if not exists phone_verified_at timestamp with time zone;

  drop policy if exists "Users can view own seller verifications" on public.seller_verifications;
  create policy "Users can view own seller verifications"
    on public.seller_verifications for select to authenticated
    using (auth.uid() = user_id);

  drop policy if exists "Users can create own seller verifications" on public.seller_verifications;
  create policy "Users can create own seller verifications"
    on public.seller_verifications for insert to authenticated
    with check (auth.uid() = user_id);

  drop policy if exists "Users can update own seller verifications" on public.seller_verifications;
  create policy "Users can update own seller verifications"
    on public.seller_verifications for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

  do $$
  begin
    if to_regclass('public.cards') is not null then
      execute 'alter table public.cards enable row level security';

      execute 'drop policy if exists "Public can view cards" on public.cards';
      execute 'create policy "Public can view cards"
        on public.cards for select
        using (true)';

      execute 'drop policy if exists "Approved sellers can create cards" on public.cards';
      execute 'create policy "Approved sellers can create cards"
        on public.cards for insert to authenticated
        with check (
          auth.uid() = seller_id
          and exists (
            select 1
            from public.seller_verifications sv
            where sv.user_id = auth.uid()
              and sv.status = ''approved''
          )
        )';

      execute 'drop policy if exists "Sellers can update own cards" on public.cards';
      execute 'create policy "Sellers can update own cards"
        on public.cards for update to authenticated
        using (auth.uid() = seller_id)
        with check (auth.uid() = seller_id)';
    end if;
  end
  $$;
