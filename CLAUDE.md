# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CardVerse is a trading-card marketplace (Pokémon, One Piece, Soccer) where users buy, sell, bid, and "razz" cards. It is a Next.js 16 App Router app (React 19, TypeScript, Tailwind) backed by Supabase, with a Vietnamese-first audience (vi/en/ja localization, Vietnamese payment & shipping providers). Deployed on Netlify.

## Commands

```bash
npm run dev      # next dev — local dev server
npm run build    # next build — production build
npm run start    # next start — serve the production build
npm run lint     # next lint (ESLint, eslint-config-next)
```

There is no test runner configured. Standalone `.ts` scripts (crawlers, `test-ebay-sold.ts`) are run with `npx ts-node <file>` and load `.env` via `dotenv` — they need Supabase env vars exported or present in `.env`.

**Build caveat:** `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so `npm run build` will NOT catch type errors. Run `npx tsc --noEmit` to actually type-check.

## Environment

All secrets live in `.env` (gitignored). Required keys span several integrations — Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), Cloudinary, Firebase (`NEXT_PUBLIC_FIREBASE_*`), eBay (`EBAY_*`), Groq (`GROQ_API_KEY`), Google GenAI (`GOOGLE_API_KEY`), PayOS (`PAYOS_*`), SMTP (`SMTP_*`), and parcel tracking (`SEVENTEENTRACK_API_KEY` for the API, `SEVENTEENTRACK_WEBHOOK_TOKEN` — a secret we choose ourselves, since 17TRACK does not sign its pushes). Many clients are lazy-initialized (e.g. `src/lib/payos.ts`) specifically so a missing key doesn't crash `next build`.

## Architecture

App Router under `src/app`. Path alias `@/*` → `src/*`. Routes are split by marketplace action (`/buy`, `/sell`, `/bid`, `/razz`, `/orders`, `/wallet`, `/transaction`) and by card category (`/pokemon`, `/onepiece`, `/soccer`, `/cards`, `/products`). `src/app/api/*/route.ts` holds server route handlers.

### Data layer — Supabase
Three client entry points, do not mix them:
- `src/lib/supabase/client.ts` — browser client (`getSupabaseClient()` singleton).
- `src/lib/supabase/server.ts` — server-component/route client (uses `next/headers` cookies).
- `src/lib/supabase/index.ts` — re-exports the **client-side** pieces plus auth hooks. It deliberately does NOT export `server.ts`; import that directly in server code.

`database.types.ts` is the hand-maintained typed schema (`Database`, `Tables`, etc.). Auth flows through `SupabaseAuthProvider` (`src/lib/supabase/auth-provider.tsx`) exposing `useAuth`/`useUser`/`useSupabase`. SQL schema lives in `supabase/migrations/`; serverless logic in `supabase/functions/` (Deno edge functions: `sync-tcgcsv`, `get-featured-product`, `get-price-history`, `send-forum-notification`).

### Card catalog & data ingestion
Pokémon and One Piece card/set data comes from **TCGCSV** (TCGplayer data) stored in the `tcgcsv_products` table and exposed via Supabase **materialized views**. `src/lib/card-catalog.ts` reads sets from those views for Pokémon/One Piece and falls back to curated static lists for other categories. Ingestion is external to the app:
- `scripts/crawl-*.{ts,sh}` crawl TCGCSV, PSA, eBay/Topps, and soccer sources.
- `scripts/crawl-pok-{en,jp}.sh` POST to the `sync-tcgcsv` edge function in batches, then call the `refresh_pokemon_views` RPC.
- `scripts/com.cardverse.sync-pokemon-*.plist` are macOS launchd jobs that run those syncs on a schedule, logging to `logs/`.

### Middleware (`src/middleware.ts`)
Two responsibilities: (1) **Beta gating** — `/bid`, `/razz`, `/forum` are hard-redirected to `/?beta=true` ("coming soon"); (2) Supabase session refresh on every request. When enabling a gated feature, remove it from `restrictedPaths`.

### Providers (`src/app/layout.tsx`)
Global context is composed in the root layout, nested in this order: `SupabaseAuthProvider` → `AuthReady` → `AuthModalProvider` → `CurrencyProvider` → `LocalizationProvider` → `TransactionLockProvider` → `CardCacheProvider`. Notable contexts: `currency-context` (VND/USD display), `card-cache-context` (client-side card caching), `localization-context` (language → locale).

### Localization
`src/lib/i18n.ts` maps languages to dictionaries in `src/lib/i18n/{en,ja,vi}.ts`. `TranslationKey` is keyed off the English dictionary, so **every key added to `en.ts` must also exist in `ja.ts` and `vi.ts`**. `localization-context.tsx` falls back to `en-US` when a key is missing in the active locale. Note many domain `types.ts` unions include both English and Vietnamese variants (e.g. `CardCondition`).

### AI features (two providers)
- **Groq** (`groq-sdk`) — vision/LLM for soccer card identification (`/api/identify-soccer`). Route handlers do in-memory per-IP rate limiting. (Groq no longer does KYC: `/api/seller/ai-check` was removed when identity moved to Didit — see below.)
- **Genkit + Google Gemini** (`src/ai/genkit.ts`, model `googleai/gemini-2.5-flash`) — flows under `src/ai/flows/` (e.g. `suggest-similar-sales.ts`). `src/ai/dev.ts` is the Genkit dev entry.

The card **scan** feature is credit-gated: `/api/scan/decrement-credit` plus `device-fingerprint.ts` track per-device usage (see `device_scan_usage` migration), and credits/passes are sold via PayOS (`PACKAGES` in `src/lib/payos.ts`).

### Seller onboarding & KYC
Identity is established by **Didit** (`src/lib/kyc/`, `/api/seller/kyc/{session,webhook}`) and
the payout account by **VietQR/NAPAS** (`src/lib/vietqr.ts`, `src/lib/bank-verification.ts`).
`/api/seller/verify` binds the two and has exactly three outcomes — approved on the spot,
**409 hard-block** for a document or bank account already used by another account, or 422 for
anything the user can fix and re-submit. Nothing waits in an admin queue unless
`KYC_AUTO_APPROVE=false`. Uniqueness is enforced by partial unique indexes on
`seller_verifications`, not just by the route. Full detail in **`docs/kyc-didit.md`** — read it
before touching the seller flow.

### Payments & shipping (Vietnam-specific)
- **PayOS** (`src/lib/payos.ts`, `/api/payos/*`) — payment links, `webhook` and `return` handlers, credit/day-pass packages.
- **Addresses are local data, not an API** (`src/lib/vn-address.ts`, `src/data/vn-*.json`, `/api/address/*`). Two levels: province and ward. Vietnam merged 63 provinces into 34 on 12/6/2025 and abolished the district tier on 1/7/2025, so a district no longer exists to collect — the `*_district_*` columns are kept only for rows written before that. The lists used to come from GHN's master-data endpoint, and when its token stopped matching its gateway the whole address step went down; `npm run data:address` refreshes the vendored copy from provinces.open-api.vn **v2** (v1 still serves the pre-2025 structure).
- **Two address stores, and they are not interchangeable.** `profiles.goship_pickup` is where a seller **ships from** — the sender block on the waybill, in GoShip's pre-2025 divisions, and the only geography bookings and rate quotes route on. Set it with `SenderAddressForm`; saving it also writes `profiles.address_province_id/name/ward_code/detail`, which is all the seller-address gate and `resolveShippingTier` ever read, so those columns are derived and never entered by hand. GoShip's 63 province names all resolve against the region lists in `shipping-fee.ts` (they were written in those names), and its city ids are six digits so they cannot collide with 1–2 digit official codes. The `shipping_addresses` table behind `AddressBook` is where a user **receives** parcels — it belongs on `/checkout`, `CheckoutModal` and `/profile/edit` only, never on `/sell`. Since 2026-09-11 it is picked in the **same GoShip geography** (`GoshipRegionPicker`, three levels) and `/api/shipping-addresses` copies GoShip's ids and names into `province_*`/`district_*`/`ward_*` the way the pickup route does for the seller, so `resolveShippingTier` compares like with like; `/api/address/*` and `vn-address.ts` (the 2025 structure) are no longer used by any address form. Rows with `goship: null` predate that — the book flags them, opens the form instead of selecting them at checkout, and PATCH refuses to make one the default until it is re-picked. Both checkout paths must send `to_goship`, or the order is never bookable. Never translate between the two structures by name: Ho Chi Minh City now contains wards GoShip still files under Bà Rịa - Vũng Tàu, so a name match books a pickup in the wrong city and reports success.
- **Shipping is priced from the shop's fee table** (`src/lib/shipping-fee.ts`, `verified-shipping.ts`). Three cells per carrier — the distance tiers intra/inter/region, resolved from province name, so adding a province to the region lists in `shipping-fee.ts` is what makes it quotable. Cells hold **postage only**. A cell the seller left empty is `DEFAULT_SHOP_TIER_FEES` in `shipping-fee.ts` — a fixed 20,000/22,000/25,000đ that is also what "Dùng giá đề xuất" fills in, so the placeholder, the default and the charge are one table. A cell the seller does fill must sit in `SHOP_TIER_FEE_MIN`–`SHOP_TIER_FEE_MAX` (20,000–50,000đ), enforced in the input, in `/api/shipping/fee-table`, and on read by `shopFeeCell` — a cell stored outside the band (an older save) is ignored in favour of the default rather than charged. Live GoShip quotes (`profiles.goship_tier_fees`, `src/lib/goship-tiers.ts`) were that fallback until 2026-09-11 and are no longer read anywhere; the column stays for the orders priced from it. Each carrier declares which tiers it can serve (`tiers` in `shipping-carriers.ts`); every offerable one serves all three. A shop whose saved list has nothing offerable left in it (everything it ticked has since been retired) reads as *no preference* — the whole bookable set — in both `shopShippingRange` and `offeredCarriers`, and those two must keep agreeing or the span stops containing the charge.
- **Hand delivery (`self`) is retired** (`offerable: false`, 2026-09-11). It priced at 0đ and sorted first, so once the buyer stopped choosing a carrier every same-province order silently became a meeting, and the listing's range — which excludes a 0đ only that province could have — could never contain what such a buyer was charged. The mechanics stay for orders already placed that way: `booksWithCarrier` is false for `self`, so the resolver returns 0 before consulting any table or listing override, and `/api/shipping/book` refuses a waybill for an order whose `metadata.shipping_carrier` is `self` (`code: hand_delivery`) — a real `goship_fee` on a 0đ order would be netted off the seller's payout in full. Contrast free shipping, where the seller absorbs the whole carrier bill on purpose.
- **Retiring a carrier is a flag, not a deletion.** `offerable: false` in `shipping-carriers.ts` (VNPost, BEST and hand delivery, since 2026-09-11) keeps the entry so shipped orders still resolve a name, logo and tracking link, and removes it from everything forward-looking: read `OFFERABLE_CARRIERS`/`OFFERABLE_COURIERS` for the picker, the fee table, the range, and the default set at checkout, and only order history may read `SHIPPING_CARRIERS`. `/api/shipping/fee-table` also filters retired codes and out-of-band cells out of what it returns, so a stale row cannot ride back up and fail a save the seller cannot see.
- **Never print one shipping number before checkout.** Until a delivery address exists the price is a span — carrier, distance and the card's own value all move it — so listing cards and the cart use `src/lib/shipping-range.ts` (`listingShippingRange`, `parcelShippingRange`, `formatShippingRange`) and show `min – max`. A signed-in buyer with a saved address gets no span at all: the cart and the listing page quote the real fee through `fetchShippingOptions` and print one number, and the span is what is shown to somebody the page does not know. The exact figure comes from the checkout resolver alone. `PLATFORM_SHIPPING_FEE` is a last-resort value for *computing* a charge, never a number to display: no carrier quotes 25,000đ.
- **Khai giá is added on top at checkout**, never stored per shop (`src/lib/khai-gia.ts`). It is identical on every route but differs wildly by carrier and by value: SPX steps to a flat 25,000đ at exactly 3,000,000đ, GHN 0.5% from 1,000,000đ, J&T 0.55%. (VNPost, which charged nothing at any amount, and BEST, 0.5% and then **1% above 10,000,000đ**, are retired — `offerable: false` in `shipping-carriers.ts` — and keep their models only for orders already shipped with them.) Those are measured, not documented — `npm run verify:khaigia` replays the sweep against live GoShip and fails on any change beyond rounding. Sweep the whole value range when adding a carrier; BEST's second band was missed by a sweep that stopped at ten million.
- `cards.shipping_fee` overrides the table for one listing and is **all-in** (no khai giá added): 0 is free shipping, null means "use the table". Never coerce that null with `Number()` — `Number(null)` is 0, which silently means free shipping.
- **The buyer never picks a carrier, and never prices a parcel.** Every buyer-facing figure comes from `POST /api/shipping/options` (`listCheckoutShippingOptions`, the same resolver that bills the order), through the client helper `src/lib/shipping-options-client.ts`; the options come back cheapest-first and **the cheapest is what is charged** — `quoteCheckoutConfiguredShippingBatch` applies the identical rule to an order that names no carrier, so a preview cannot drift from the charge. The carrier picker was removed from `/checkout` and from `CheckoutModal` on 2026-09-11, and neither sends `shipping_carrier`/`shipping_carriers` any more. Never re-add a browser-side fee: the one-click dialog used to read `cards.shipping_fee` and fall back to `PLATFORM_SHIPPING_FEE`, showing 25,000đ on parcels the server then billed from the shop's table. GoShip sells exactly one service per carrier, so there is no express tier to offer — do not add a column for one without a quote that shows two.
- `npm run verify:shipping` checks the fee, range and payout arithmetic with no network. Both verify scripts run under `node --experimental-strip-types`; `scripts/alias-loader.mjs` is what makes `@/…` imports resolve outside Next, and `.env` is parsed by hand because its tokens contain characters a shell would try to interpret.

- Sellers book their own shipments and paste the tracking number back; delivery status comes from 17TRACK (`src/lib/carrier-tracking.ts`), never from a carrier's own webhook. See `docs/money-flow.md`.

### Pricing data
eBay sold-listing scraping (`/api/ebay-scrape`, `/api/search-ebay`, `cheerio` + `axios`) feeds market price comparisons. `/api/ebay-deletion` implements eBay's account-deletion notification endpoint (`EBAY_VERIFICATION_TOKEN`).

### Media
Images go through Cloudinary (`src/lib/cloudinary.ts`, `cloudinary-url.ts`) and/or Firebase storage (`src/lib/firebase.ts`). `next.config.ts` allows remote images from any HTTPS host.

### UI
shadcn/ui pattern: primitives in `src/components/ui` (Radix + `class-variance-authority` + `tailwind-merge` via `cn()` in `src/lib/utils.ts`). `components.json` configures the shadcn generator. Dark theme is forced (`<html className="dark">`). Custom fonts: Inter (body), Orbitron & Quantico (display).

**`Button` draws its own spinner — never add one yourself.** `src/components/ui/button.tsx` renders a
`<Loader2 className="animate-spin">` before the children whenever it is busy, and it becomes busy in
**two** ways: an explicit `loading={...}` prop, *or* — the easy one to miss — an `onClick` that returns
a promise, which is every `onClick={someAsyncHandler}`. So putting a `<Loader2 …animate-spin>` (or a
phosphor `SpinnerGap`) inside `<Button>` children gives the user **two spinners side by side**. That
bug reached production on the checkout button and 23 other call sites; they were all cleaned up.

Rules for call sites:
- Just render the label. Let the Button spin. The label stays visible while busy, which is intended.
- A leading icon (`<Save/>`, `<Truck/>`, `<CheckCircle/>`) should hide while busy: `{busy ? null : <Save …/>}`.
- Pass `loading` **only** for `type="submit"` buttons, where the work belongs to `onSubmit`, not to the click.
- `size="icon"` replaces the children with the spinner (`button.tsx:140`), so an icon button needs no
  conditional of its own.
- `asChild` injects no spinner at all (Slot takes exactly one child) — it only dims and blocks the press.

Two idioms currently suppress the duplicate **by accident**, not by design — `onClick={() => void fn()}`
(the `void` discards the promise, used in `chat-drawer.tsx` and a few offer buttons) and `size="icon"`.
Removing a `void`, or giving an icon button a text label, silently reintroduces the double spinner.

**Category badge codes:** compact category badges/chips must display the standardized short code (e.g. "Bóng đá"/"Soccer"/"Football" → `SOC`; Pokémon → `POK`; One Piece → `OP`; Yu-Gi-Oh → `YGO`; Basketball → `NBA`; F1 → `F1`; Other/Khác → `OTH`). The single source of truth is `getCategoryCode()` in `src/lib/category-code.ts` — always import it (used by `card-item.tsx` and the product-detail related-cards rail) rather than re-deriving codes, so they stay consistent. Never render the raw localized category name inside a code-style badge.

**Category badge colors** mirror the navbar's per-category palette: **POK → yellow** (`bg-yellow-400` / dark text), **OP → red** (`bg-red-500`), **SOC → green** (`bg-green-500`), everything else → neutral (`bg-zinc-800`), each with a matching colored glow. The mapping lives in `categoryBadgeClass()` inside `src/app/cards/[id]/page.tsx` (NOT in `src/lib`, because Tailwind only scans `src/{app,components,pages}` for class names — color classes placed in `src/lib` won't be generated). Reuse/extend that mapping when adding category badges elsewhere.
