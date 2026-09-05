# Marketplace performance implementation status

Last checked: 2026-09-05. Local changes only; no commit, deployment, or migration applied.

## Implemented

- File upload previews allocate one object URL per mounted file and revoke it on replacement/unmount.
- Cart and seller listing sections mount only the matching responsive layout.
- Order countdowns update isolated children, stop at their deadline, and pause in background tabs. The delivery reminder retains its timed transition.
- Listing image carousels and the hero carousel pause outside the viewport, in background tabs, or with reduced-motion enabled.
- Inbox code is dynamically imported when opened, rather than loaded with every header.
- A root subscription provider shares one query/realtime subscription across consumers. Responses are account-scoped and versioned; account changes mask old entitlement data. Expiry and tab visibility refresh the data.
- Header cart count uses an authenticated head/count query, without downloading all cart cards/profiles.
- Checkout callers request `/api/wallet?view=balance`, avoiding history and statement aggregation when only a balance is needed. The existing full wallet endpoint retains its statement integrity checks.
- Buy reuses a successful server listing read, including an empty result. A failed server read or a reservation release can still refresh it. Offer results are fetched separately and obsolete requests aborted. Removed the unused pre-checkout seller-address query.
- Pokémon and One Piece search input is debounced and prior requests are aborted; obsolete responses cannot overwrite the active result.
- Product and price history requests run independently with cancellation. The product no longer waits for price history before rendering; a session preview must match the requested product ID.
- Scan warm-up runs on scan intent (hover, focus, upload, camera, paste/drop through the existing handlers), not on every homepage visit or a recurring keep-alive timer.
- Cart checkout uses two batched, owner-scoped reads instead of two reads per item. Shipping profiles are read in a single batch using the same validation/calculation as the single-seller quote. Request order, atomic settlement RPC, idempotency key, bundle rejection, availability checks, self-purchase protection, trusted fees, and one shipping charge per seller are retained.
- Added responsive `sizes` for cart, checkout, order, and seller-order thumbnails.

## Second pass — navigation cost (2026-09-05)

Measured on production first, then fixed locally. Production numbers below are from
the authenticated account on `cardversehub.com` with the code as deployed.

- **Header and Footer moved from every page into the root layout.** Rendered per page they
  unmounted and remounted on every navigation, and each mount reopened the cart badge, the
  offer badge, the notification bell, the chat inbox and the subscription query. A client-side
  navigation to `/sell` cost 8 data requests on production; it now costs 3, and to `/buy` 7 → 2.
  Verified in the browser: the `<header>` DOM node is the same object before and after a
  navigation, so React keeps it mounted.
- **`loading.tsx` added for 24 routes** (list / detail / panel skeletons in
  `src/components/route-loading.tsx`). There were none, so a link click left the previous page
  on screen until the server answered. Header and Footer now live above the boundary, so the
  chrome stays put and only the body swaps.
- **`/api/account/summary`** answers both header badges and the seller dashboard's offer counts
  from one request: one identity check, then three queries that do not depend on each other.
  Replaces `/api/cart?view=count` + `/api/offers/inbox?summary=account` at those call sites;
  both endpoints remain for the pages that need their full payloads.
- **Client access goes through `src/lib/account-summary.ts`**, which shares a request already in
  flight and reuses a result for 5s. This is what removes the duplicate badge fetch: the header
  effect reran when auth resolved from `null` to a user while the first request was still open.
  Cart and offer mutations invalidate it.
- **The received-offer count is one hop, not two.** It read every card the seller owns and fed
  those ids into a second query against `offers`; it is now a single `cards!inner(seller_id)`
  join. Checked against production data for a seller with pending offers: identical
  `receivedPending` and `cardPendingCounts`.
- **The Didit poll in `GET /api/seller/kyc/session` is opt-in (`?poll=1`).** Only the callback
  page, the in-flight poll loop and the explicit "check again" buttons reach the provider; a
  plain `/sell` load reads the stored status the webhook keeps current. Note the 4.3s first
  measured for this endpoint was a Netlify cold start, not the provider call — warm production
  is 0.9-1.3s for an already-approved seller, and this change does not move that number. It
  removes a live provider call for sellers who are still mid-verification.
- **`getRouteUser()` (`src/lib/supabase/route-user.ts`)** replaces `auth.getUser()` in the GET
  handlers of cart, offers inbox, marketplace orders, wallet and shipping addresses. It reads
  verified JWT claims instead of asking the auth server for the whole user record. **This saves
  nothing yet**: the project still signs with the legacy HS256 shared secret (its JWKS is empty),
  so the library falls back to the same network call. It becomes local verification, and drops
  roughly 200-350ms from each of those routes, once the project's JWT signing key is rotated to
  ECC in the Supabase dashboard. Write handlers were deliberately left on `getUser()`.

Not addressed, and still the largest remaining items:

1. `/cart`, `/checkout`, `/orders`, `/wallet`, `/offers`, `/profile`, `/collection` and `/sell`
   serve a 66-character shell: `AuthReady` gates them, and it sits above the Header in the
   layout, so nothing paints until auth resolves client-side. Letting the chrome render while
   auth resolves means reordering the provider stack above `AuthReady`, which is the cascade its
   own comment warns about — worth doing, not worth doing blind.
2. Netlify functions run in the US while the audience is in Vietnam. A route that touches no
   database at all answers in 450-900ms, which is the floor under every number above. Moving the
   function region is a deploy setting, not code, and would roughly halve all of them.
3. The `/buy` server fetch still reads every active listing with `select('*')`. Fine at 12
   listings (20KB, 360ms); it is the first thing that will hurt as the catalogue grows.

## Verification

- `node --test scripts/performance-regression.test.mjs`: 13/13 passing (the thirteenth covers `/api/account/summary`: one auth check, head-only cart count, the one-hop offer join, owner scoping on both sides, and a 401 when signed out). Tests exercise the real TypeScript handlers against isolated database/payment mocks: batch reads, ownership, authentication, duplicate items, sold/self/bundle rejection, shipping configuration failure, retained settlement RPC, shipping totals/carrier, balance-only wallet, and head-only cart count. They do not execute PostgreSQL or a real payment.
- `npx tsc --noEmit`: passed after production build. Do not run it concurrently with build: Next regenerates `.next/types`, causing missing generated-file diagnostics.
- `npm run lint -- --quiet`: passed after correcting the new provider and test harness. The full lint run also reports existing warning-level repository debt.
- `npm run build`: passed with network access; the sandboxed attempt failed to download Google Fonts. Next skips type checking, so the separate TypeScript result above is required.
- Browser skill: checked the local production server at `127.0.0.1:3100` with 390×844 and 1440×900 viewport overrides. Buy, Cart, Sell, Orders, Wallet, and Pokémon had document scroll width equal to viewport width. The populated cart had three `article` elements at both widths (one responsive tree). Orders and wallet data loaded. These are responsive smoke checks, not a full interaction/financial UAT or a speed benchmark. The seller listing tabs/rows were not fully exercised in the available seller state.
- No payments, cart modifications, shipping actions, withdrawals, or new listings were submitted in the browser. Viewport override reset after checking.

## Remaining approved plan work

1. Database-side pagination/filter/sort for Buy, seller listings, and Orders, preserving page sizes, facet choices, counts, and joined seller search. Current Buy still downloads the complete active listing dataset once.
2. Shared account-count caching across header mounts; full wallet history/statement separation with independent loading and pagination. The wallet page itself still requests the full response.
3. Collection/profile pagination and database aggregates; bounded soccer/eBay search fallbacks and token caching; lazy chart bundle extraction; finish the image `sizes` audit.
4. Durable transactional outbox, idempotent delivery worker, retry policy, and confirmed scheduler. Post-payment notifications/chat/email remain on their existing awaited path until durable delivery is ready. Do not replace them with unawaited promises.
5. Move maintenance off GET only after the worker/schedule is deployed and verified. **Do not set `MARKETPLACE_MAINTENANCE_WORKER_READY=true` now**: that worker is not implemented/verified in this patch. Existing full wallet/order maintenance remains the fallback.
6. PostgreSQL migration/regression tests and production-build before/after LCP/INP/CLS, request/payload, and API p50/p95 measurements with authenticated, representative datasets on both device sizes. No quantitative production speedup has been established yet.
