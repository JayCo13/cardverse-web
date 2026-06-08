-- Duplicate KYC detection: flag when a seller reuses a CCCD / bank account that
-- already belongs to ANOTHER account (ban-evasion, multi-account sharing).
--
-- We persist the CCCD id number directly on seller_verifications (currently only
-- on kyc_verification_scans) so cross-account lookups are a simple indexed query,
-- plus a flag + human-readable note the admin review UI can surface.

alter table public.seller_verifications
    add column if not exists cccd_id_number text,
    add column if not exists is_duplicate boolean not null default false,
    add column if not exists duplicate_notes text;

-- Backfill cccd_id_number from each row's linked scan so existing accounts are
-- also covered by the cross-account check going forward.
update public.seller_verifications sv
set cccd_id_number = s.cccd_id_number
from public.kyc_verification_scans s
where sv.ai_scan_id = s.id
  and (sv.cccd_id_number is null or sv.cccd_id_number = '')
  and s.cccd_id_number is not null
  and s.cccd_id_number <> '';

-- Indexes to make the duplicate lookup cheap.
create index if not exists idx_seller_verifications_cccd_id_number
    on public.seller_verifications (cccd_id_number);
create index if not exists idx_seller_verifications_bank_account_number
    on public.seller_verifications (bank_account_number);
