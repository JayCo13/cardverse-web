# Seller and KYC Flow Implementation Summary

## Scope

This document summarizes the seller verification, listing protection, image-processing, and marketplace fixes that were implemented in the current branch. It is written as a technical handoff so both engineers and AI agents can understand the current state of the seller flow without re-reading the entire codebase.

## Business Goals Covered

The work in this branch focused on five main areas:

1. Harden the KYC verification flow so the backend does not trust client-sent verification results.
2. Enforce seller approval before listing creation.
3. Support editable bank account details after the scan step.
4. Improve HEIC image handling and reduce KYC scan latency.
5. Align the database schema with the actual seller and marketplace code paths.

## High-Level Flow

The current seller flow is:

1. The user opens `/sell`.
2. Step 1 collects:
   - Full name
   - CCCD front image
   - CCCD back image
   - Bank QR / bank app screenshot
   - Selected bank name
3. The user manually starts the scan.
4. Images are uploaded to Cloudinary.
5. Groq reads Cloudinary-hosted image URLs through `/api/seller/ai-check`.
6. The backend stores a server-owned scan record and returns the extracted result.
7. The user can edit scanned bank account name and account number before final submission.
8. Step 2 collects the seller phone number and validates only Vietnamese phone format.
9. Step 3 submits the KYC request through `/api/seller/verify`.
10. Admin manually reviews the seller before approval.
11. Only approved sellers can create listings through `/sell/create` and `/api/marketplace/listings`.

## Frontend Changes

### `src/app/sell/page.tsx`

This page now contains the main KYC workflow behavior:

- Removed automatic scan triggering from `useEffect`.
- Added a manual scan button so scanning only starts when the user explicitly clicks it.
- Disabled scan until all required Step 1 inputs are present:
  - full name
  - front CCCD image
  - back CCCD image
  - bank screenshot
  - bank name selection
- Reworked the flow so bank account name and account number returned by the scan are shown in editable inputs.
- Removed Firebase OTP dependency from the seller KYC process.
- Kept phone number validation as a format-only Vietnamese mobile check.
- Added phase-based progress messages for:
  - preparing upload
  - uploading images
  - checking CCCD and bank data
- Added dev timing logs so slow stages can be isolated in the browser console.
- Reused previously uploaded KYC image URLs where possible instead of forcing repeated uploads.

### `src/app/sell/create/page.tsx`

This page now behaves as a protected seller listing page:

- Seller listing creation goes through the protected marketplace listing API.
- Unapproved sellers are blocked at the page level.
- Listing payload continues to support:
  - sale
  - auction
  - razz
  - bundle flags
  - offer settings

## Backend API Changes

### `src/app/api/seller/ai-check/route.ts`

This route was significantly hardened and improved:

- The backend no longer treats client-side scan results as trusted.
- The route performs the actual Groq vision requests.
- The route stores server-owned scan data and returns a `scan_id`-based result flow.
- Rotation handling was added to CCCD prompts so sideways or upside-down CCCD images are still valid.
- Cloudinary-hosted image URLs are used instead of browser-generated base64 payloads.
- Dev-only debug data can be returned to inspect the exact URLs sent to Groq.
- More detailed failure types are returned, such as:
  - unreadable image
  - wrong side
  - low confidence
  - network or provider issue
- A fallback pass was added for ambiguous CCCD back-side classification.
- User-facing references to "AI" were replaced with "Our System" where applicable.

### `src/app/api/seller/verify/route.ts`

This route now acts as the trusted final KYC submission step:

- It no longer trusts `ai_confidence` or `ai_name_match` from the client.
- It loads the canonical scan result from server-controlled data.
- It validates that the scanned CCCD name matches:
  - the submitted seller full name
  - the final submitted bank account name
- It stores both the final KYC submission and AI audit information.
- It now validates phone number format only, without Firebase OTP.

### `src/app/api/marketplace/listings/route.ts`

This route was added to enforce seller approval at the API layer:

- Listing creation no longer depends only on UI gating.
- The route checks the seller's KYC approval state before inserting into `cards`.
- This closes the direct-request bypass where an unapproved seller could previously create a listing without using the intended UI flow.

### `src/app/api/uploads/cloudinary-signature/route.ts`

This route supports direct KYC uploads to Cloudinary:

- Authenticated users can request a signed upload config.
- KYC files are uploaded directly from the browser to Cloudinary.
- This avoids routing large image files through the Next.js server.

## Image and Performance Work

### HEIC Handling

The original browser-side HEIC conversion path was removed because it caused high CPU usage, memory pressure, and tab instability.

The new approach is:

1. Upload the raw file directly to Cloudinary.
2. Let Cloudinary decode and transform HEIC server-side.
3. Generate a JPEG delivery URL for Groq.
4. Send the optimized Cloudinary URL to `/api/seller/ai-check`.

### `src/lib/cloudinary-direct.ts`

Added direct upload support for KYC assets:

- Signed upload support for browser-to-Cloudinary flow.
- Per-upload timing logs for debugging latency.

### `src/lib/cloudinary-url.ts`

Added and refined Cloudinary KYC delivery logic:

- Separate scan-quality delivery URLs from stored original asset URLs.
- Increased KYC image fidelity for Groq, especially for CCCD back images.
- Used higher-quality JPEG transformations instead of aggressive generic optimization.

### `src/lib/cloudinary.ts`

Updated upload behavior to reduce memory overhead:

- Removed the expensive base64-heavy upload pattern where applicable.
- Shifted toward direct binary streaming behavior.

## Phone Verification Decision

The seller KYC flow no longer requires OTP verification.

Rationale:

- Seller approval still requires manual admin review.
- The combination of CCCD, bank screenshot, extracted data, and admin review provides the main trust layer for this flow.
- OTP at this stage added cost, friction, and local-development instability without enough security benefit for this specific business policy.

The current phone rule is:

- Require a valid Vietnamese phone number format.
- Store that number in the seller verification request.
- Let admin review it as part of the seller approval process.

## Database and Schema Changes

### `supabase/migrations/20260607_secure_kyc_and_seller_listing.sql`

This migration aligns KYC and listing protection with the implemented flow:

- Removes reliance on `selfie_url`.
- Adds or aligns seller verification fields such as:
  - `bank_screenshot_url`
  - `phone_number`
  - `ai_cccd_name`
  - `ai_bank_name`
  - `ai_bank_number`
  - `ai_confidence`
  - `ai_name_match`
- Adds `kyc_verification_scans`.
- Adds or updates RLS behavior for KYC flows.
- Adds listing-related enforcement for approved sellers.

### `supabase/migrations/20260607_restore_cards_table.sql`

This migration restores and aligns the `cards` table for marketplace listing creation:

- Recreates `public.cards` if it is missing.
- Adds missing marketplace columns used by the current frontend and API:
  - `set_name`
  - `accept_offers`
  - `min_offer_percent`
  - `is_bundle`
  - `bundle_items`

### `supabase/migrations/20260607_restore_orders_table.sql`

This migration restores and aligns the `orders` table for seller order loading and post-purchase flows:

- Recreates `public.orders` if it is missing.
- Adds shipping and GHN-related fields expected by the current marketplace order API.
- Reintroduces indices and key foreign keys where the referenced tables exist.

### `src/lib/supabase/database.types.ts`

The generated or maintained Supabase types were updated to match the current seller and marketplace schema, including additional `cards` fields used by listing creation.

## Security Improvements

This branch improves the security posture of the seller flow in several ways:

- Client-sent KYC verdict fields are no longer trusted as the source of truth.
- Listing creation is protected both in the UI and in the API.
- KYC scans are backed by server-owned records rather than raw client assertions.
- Bank name and bank account holder checks are enforced during backend verification.

## Debugging and Observability

The branch adds practical debugging support for slow or unstable KYC scans:

- Frontend timing logs for:
  - signature fetch
  - Cloudinary upload
  - total scan duration
- Backend timing logs for Groq scan phases
- Dev-only debug image URLs to inspect the actual assets sent to Groq
- Clearer error categorization for wrong-side and unreadable-image failures

## Known Operational Dependencies

The current flow assumes the following environment and infrastructure are available:

- Supabase project with the required marketplace and KYC tables
- Cloudinary credentials for upload signing and delivery
- Groq API key for vision extraction
- Valid Supabase auth session for seller routes

If the app still reports missing tables after migrations are run, the most likely cause is that the local app is pointed at a different Supabase project than the one where SQL was executed.

## Files Added or Updated in This Seller/KYC Work

### Added

- `src/app/api/marketplace/listings/route.ts`
- `src/app/api/seller/phone-verify/route.ts`
- `src/app/api/uploads/cloudinary-signature/route.ts`
- `src/lib/cloudinary-direct.ts`
- `src/lib/firebase-server.ts`
- `src/lib/kyc-verification.ts`
- `src/lib/supabase/service.ts`
- `supabase/migrations/20260607_secure_kyc_and_seller_listing.sql`
- `supabase/migrations/20260607_restore_cards_table.sql`
- `supabase/migrations/20260607_restore_orders_table.sql`

### Updated

- `src/app/api/seller/ai-check/route.ts`
- `src/app/api/seller/verify/route.ts`
- `src/app/sell/page.tsx`
- `src/app/sell/create/page.tsx`
- `src/lib/cloudinary-url.ts`
- `src/lib/cloudinary.ts`
- `src/lib/firebase.ts`
- `src/lib/supabase/database.types.ts`
- `package.json`
- `package-lock.json`

## Current Practical Status

At this point, the seller flow is structured around:

- server-trusted KYC scan results
- direct Cloudinary upload for KYC images
- editable post-scan bank fields
- admin-reviewed seller approval
- protected listing creation
- restored marketplace schema support through new migrations

The remaining operational checks are mostly environment and database alignment tasks:

- confirm the correct Supabase project is being used
- run the new restore migrations where tables are missing
- verify Cloudinary and Groq credentials in the active environment

## Recommended Next Checks

1. Run the restore migrations for `cards` and `orders` in the active Supabase project.
2. Confirm the app points to the same Supabase project where those migrations were applied.
3. Re-test:
   - `/sell`
   - `/sell/create`
   - seller KYC submission
   - seller orders page
4. Inspect browser and server timing logs if any remaining latency is observed in the KYC scan flow.
