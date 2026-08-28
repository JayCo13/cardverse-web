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

The phone number is a contact detail only: it is format-checked (`0[3-9]` +
8 digits) and never used as an identity signal.

`bank_account_lookups` backs three things at once: a per-user hourly rate limit
that survives serverless cold starts, a 7-day cache so resubmitting the same
account does not burn quota, and an audit trail for payout disputes. Like
`kyc_sessions`, it is service-role only.

**The lookup is usually unavailable.** The smallest VietQR package is 50,000
requests against a need under 1,000 a month, so quota is exhausted far more
often than not — `unavailable` is the normal answer, not the exceptional one.

The flow therefore distinguishes two very different negatives:

- `unavailable` (quota, outage, rate limit) — the network never answered. The
  holder name the user typed stands in and `bank_verified_at` is recorded, so
  onboarding and payouts keep working. This is not self-assertion: the typed
  name must already match the Didit-verified document. The account *number*
  goes unverified, which is the residual risk of running without the lookup.
  The admin approve path makes the identical trade.
- `not_found` — the bank answered definitively that no such account exists.
  That is a **retry**: the user has to correct the number.

## Submission outcomes

`/api/seller/verify` has exactly three answers. There is no review queue in the
normal flow — nothing is parked waiting for a human.

**approved (200)** — the user becomes a seller on the spot. Requires all of:

- the session status is `Approved` and has not been consumed;
- the provider read a name and a document number (the latter as a keyed hash);
- the document name, the typed name, and the bank account holder all match
  after diacritic/case normalisation;
- NAPAS resolved the account number and its holder matches the document;
- neither the document nor the bank account is already used by another
  approved/pending account.

Liveness and face-match scores and provider risk warnings are recorded in
`review_flags` but **do not block**. The acceptance policy lives in the Didit
workflow, which already had its say by returning `Approved` — tighten the
thresholds there, not in this codebase, if forged documents start getting
through.

**blocked (409, `code: duplicate_identity`)** — see "Duplicate identities".

**retry (422, `code: retry`)** — something the user can fix: names that do not
match, an account number the bank says does not exist, or a session that came
back without a name or document number. No row is written; the form lists the
reasons and the user submits again.

A VietQR *outage* is deliberately **not** a retry — see "Bank account
verification" below. Only a definitive `not_found` is.

`KYC_AUTO_APPROVE=false` overrides all of this and sends every submission to
`pending` for admin review. It is a kill switch for incidents, not a mode the
product runs in.

## Duplicate identities are hard-blocked

A document number or bank account already bound to another `approved`/`pending`
verification is refused outright: 409, no `seller_verifications` row, and no
hint about which account it collided with. Re-submitting returns the same
refusal, so the UI shows a modal rather than a dismissible toast.

Three layers, because the first alone is not enough:

1. `findKycDuplicates()` in the route — the check that produces the friendly
   error and the `seller_verification_blocks` audit row.
2. A guard inside `finalize_seller_verification` — catches anything that
   reaches the RPC by another path.
3. Partial unique indexes on `seller_verifications` over
   `status in ('approved','pending')` — the only layer that survives two
   submissions racing, since neither transaction can see the other's uncommitted
   row. A loser surfaces as SQLSTATE 23505 and is mapped to the same 409.

The bank account is compared **digits-only**, through the generated column
`bank_account_number_normalized`. `verifyBankAccount()` already strips non-digits
before calling NAPAS, so without this a single space would make
`1907 5664 8370 14` a different account from `19075664837014` and buy a second
seller account. Production contained both spellings of the same account before
this was added.

`rejected` rows are deliberately excluded from all three: someone who mistyped a
stranger's account number must not lock that stranger out forever.

**Unblocking** needs no special tooling. Reject the verification that currently
holds the identity — in the admin panel, the normal Reject button — and the row
leaves `approved|pending`, the partial index releases, and the new account can
submit. Rejecting also clears `profiles.seller_verified`, so the old account
stops being able to list.

`seller_verification_blocks` records every refusal (who, which axis, which
accounts it matched). Without it a blocked user is invisible to support, since
the block leaves no verification row. It is service-role write, admin-JWT read,
and surfaced in the admin panel's "Bị chặn" tab.

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
