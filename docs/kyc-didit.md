# KYC — Didit identity verification

Seller onboarding no longer inspects ID documents itself. Identity is
established by an external provider (Didit), and CardVerse only binds that
verified identity to payout details.

## Flow

```
/sell  ──POST /api/seller/kyc/session──►  Didit /v3/session/   → hosted URL
       ◄──────── redirect ─────────────   user completes document + liveness
                                          │
Didit ──signed webhook──► /api/seller/kyc/webhook
                          │  verifies X-Signature-V2 (HMAC-SHA256)
                          │  GET /v3/session/{id}/decision/
                          └► kyc_sessions (service role only)

/sell  ──POST /api/seller/verify──► binds identity + bank details
                                    → auto-approve, or flag for admin review
```

The browser never writes a verification result. `kyc_sessions` has no grants for
`authenticated`; the UI reads status through `GET /api/seller/kyc/session`.

## Environment

| Key | Required | Notes |
| --- | --- | --- |
| `DIDIT_API_KEY` | yes | Business Console → API & Webhooks |
| `DIDIT_WORKFLOW_ID` | yes | UUID of the KYC workflow to run |
| `DIDIT_WEBHOOK_SECRET` | yes | `secret_shared_key` from the webhook destination — shown once |
| `DIDIT_BASE_URL` | no | Defaults to `https://verification.didit.me` |
| `KYC_PROVIDER` | no | Defaults to `didit` |
| `KYC_DOCUMENT_HASH_SECRET` | yes | HMAC key for document-number hashing. **Rotating it breaks duplicate detection** for existing rows |
| `KYC_MIN_LIVENESS_SCORE` | no | Default 70 |
| `KYC_MIN_FACE_MATCH_SCORE` | no | Default 70 |
| `KYC_AUTO_APPROVE` | no | Set to `false` to hold every submission for admin review. Use during rollout, before the provider config has been proven in production |
| `NEXT_PUBLIC_APP_URL` | yes | Used to build the provider callback URL |
| `VIETQR_CLIENT_ID` | yes | VietQR console → API keys |
| `VIETQR_API_KEY` | yes | Without both, bank lookup is skipped and every submission is flagged for manual review |

Webhook destination URL to register in the Didit console:
`https://<your-domain>/api/seller/kyc/webhook`, subscribed to `status.updated`.

## Bank account verification (VietQR → NAPAS)

The bank leg no longer rests on an uploaded screenshot. The seller picks a bank
from `GET /api/banks` (the VietQR directory, filtered to `lookupSupported: 1`)
and types an account number; `POST /api/seller/bank-lookup` asks NAPAS who owns
it and shows the real holder in the form.

That preview is UX only. `/api/seller/verify` runs its own lookup server-side
and compares the holder against the identity the KYC provider verified — the
client's claim is never carried over. `bank_account_name` is then stored as the
name the *network* returned, which is what `request_withdrawal` reads at payout
time.

`bank_account_lookups` backs three things at once: a per-user hourly rate limit
that survives serverless cold starts, a 7-day cache so resubmitting the same
account does not burn quota, and an audit trail for payout disputes. Like
`kyc_sessions`, it is service-role only.

If VietQR is unconfigured, rate-limited, or down, the submission is **not
blocked** — it is flagged for manual review, because a lookup outage must not
lock out a legitimate seller.

## Auto-approval

`/api/seller/verify` approves without a human when **all** hold:

- the session status is `Approved` and has not been consumed;
- the provider read a name and a document number;
- liveness and face-match scores clear the configured thresholds (a `null`
  score means the workflow has no such node and does not block);
- no provider warning has `log_type: "warning"`;
- the document name, the typed name, and the bank account holder all match
  after diacritic/case normalisation;
- NAPAS resolved the account number and its holder matches the document;
- neither the document nor the bank account is already used by another
  approved/pending account.

Anything else lands in `seller_verifications` as `pending` with `review_flags`
listing exactly why, which the admin dashboard renders at the top of the card.

## Data retention

Document images are never uploaded to Cloudinary any more — the provider holds
them, and admins view them in the Didit console. The CCCD number is stored only
as an HMAC (`document_number_hash`), which supports duplicate detection without
holding the identifier. The full provider payload lives in `kyc_sessions.decision`
for dispute handling; it is readable only by the service role and admin JWTs.

## Legacy

`kyc_verification_scans` and the `ai_*` columns on `seller_verifications` are
retained for rows created before this migration. `/api/seller/ai-check` (Groq
vision) has been removed. `card-verse-app/supabase/functions/verify-kyc` is an
older, unauthenticated copy of that route and should be deleted from the Supabase
project if it is still deployed.
