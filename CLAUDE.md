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
- **Two address stores, and they are not interchangeable.** `profiles.goship_pickup` is where a seller **ships from** — the sender block on the waybill, in GoShip's pre-2025 divisions, and the only geography bookings and rate quotes route on. Set it with `SenderAddressForm`; saving it also writes `profiles.address_province_id/name/ward_code/detail` (read only by the seller-address gate now) and re-probes `profiles.carrier_coverage` (`src/lib/carrier-coverage.ts`). The `shipping_addresses` table behind `AddressBook` is where a user **receives** parcels — `/checkout`, `CheckoutModal`, `/profile/edit`, and the "Nhập địa chỉ để xem phí ship" dialog on the grid; never on `/sell`. Since 2026-09-11 it is picked in the **same GoShip geography** (`GoshipRegionPicker`) and `/api/shipping-addresses` copies GoShip's ids into `goship` + `province_*`/`ward_*`. Rows with `goship: null` predate that — the book flags them, opens the form instead of selecting them, and nothing can be quoted or booked against them. **Checkout sends only `address_id`** (since 2026-09-12): `src/lib/checkout-address.ts` loads the caller's own `shipping_addresses` row and every field on the order — recipient, label text and GoShip ids — comes from it, so a body cannot name a cheap district in the ids and a distant one in the text. Rows without `goship` are refused (`shipping_address_invalid`). Never translate between the two structures by name: Ho Chi Minh City now contains wards GoShip still files under Bà Rịa - Vũng Tàu.
- **Shipping is GoShip's price, quoted live at checkout** (`src/lib/verified-shipping.ts`, since 2026-09-12). There is no seller fee table any more: sellers used to guess postage per carrier per distance, the platform books the parcel, and at booking the carrier the table made cheapest could turn out not to serve the route while the real postage differed from the guess — so sellers were netted for a gap they never controlled. Now `listCheckoutShippingOptions` asks GoShip `/rates` (through the 10-minute `goship_rate_cache` table, `src/lib/goship-rate-cache.ts`) from the seller's `goship_pickup` to the buyer's `to_goship`, declared value **0**, for the parcel of the listing's **product kind** (`src/lib/parcel.ts`: `PARCEL_PRESETS` keyed card/pack/deck/accessory/box/other with researched default weights and dimensions, overridden per kind by the seller's saved numbers in `profiles.parcel_overrides`; several listings ship as the heaviest kind, cards grow 50g each), filters to `shipmentCarriers(shipping_carriers, carrier_coverage)`, and rounds each carrier up to the thousand (`roundUp1000`). **The buyer picks the carrier** from that list (`CheckoutModal`, `/checkout`), and `quoteCheckoutShipping` bills that carrier by code, re-quoted — it refuses to bill a guess when no carrier is named. GoShip down → `shipping_quote_failed` (503) and checkout is blocked; there is deliberately no table fallback. `profiles.shipping_fees` is unused and kept only until a later migration drops it.
- **A seller's only shipping decisions are which couriers, and how they pack** (`ShopShippingSetup` on `/sell` and the listing wizard's step 2 for carriers; `PUT /api/shipping/shop-shipping` takes `carriers` and/or `parcelOverrides`). The booking desk shows the kind dropdown beside editable weight/dimensions prefilled from the kind, with "save as my default for this type" writing `parcel_overrides[kind]`; checkout then quotes buyers with the seller's numbers. `profiles.parcel_preset` and `cards.parcel_preset` are unused since the same day. Carriers that do not collect at the pickup address are greyed from `profiles.carrier_coverage`, probed against five destinations by `refreshCarrierCoverage` when the pickup is saved or after seven days (`POST /api/shipping/coverage` re-probes). An empty tick list is *no preference* — every collecting courier — in `shipmentCarriers`; keep the picker, the quote and the desk reading the same helper. Offerable couriers: GHN, SPX, J&T, BEST (`offerable: true` in `shipping-carriers.ts`); VNPost and hand delivery stay defined for old orders only.
- **Never print one shipping number before an address exists — and never a range either.** The grid, the listing page and the cart render `ShippingQuoteLabel`, which reads `BuyerShippingQuotesProvider` (root layout): a signed-in buyer with a default `shipping_addresses` row sees GoShip's real cheapest per seller ("từ 27.000đ"), batched one request per frame per page; anyone else sees "Nhập địa chỉ để xem phí ship", which opens the address book in place. `cards.shipping_fee` still wins outright — 0 is free shipping, a number is the seller's flat all-in price, null follows GoShip (never coerce it with `Number()`); a seller-priced listing is a single option with no carrier to pick, and GoShip's postage over that price is the seller's.
- **Khai giá is the seller's, off by default, and never charged to the buyer** (`src/lib/khai-gia.ts`). The carrier's declared-value insurance pays the *sender*; the buyer is made whole by escrow. On the booking desk (`order-shipping-desk.tsx`) the seller may switch it on, sees the fee measured live (quote at the declared value minus the same parcel at 0) next to `CARRIER_COMPENSATION` (GHN settles at most 5,000,000đ and wants an invoice; J&T 30,000,000đ with an invoice; SPX 20,000,000đ), and only what they chose comes off their payout. The per-carrier models stay as the fallback when the second quote is unavailable; `npm run verify:khaigia` still replays them against live GoShip.
- **What comes off the seller is `orders.seller_shipping_charge`**, written by `/api/shipping/book` from fresh quotes: `khai_gia_fee` + a parcel packed bigger than the kind the buyer was quoted for (in the seller's saved numbers) + (on a seller-priced listing) postage over that price. `seller_payout_for` in Postgres pays `amount − seller_shipping_charge`; an order with no `shipping_quote` (priced before 2026-09-12) is **left at null** by the booking route even when booked today, and settles on the old `goship_fee − shipping_fee` rule. The recovery path (a booking GoShip accepted whose answer was lost) recomputes the charge from the shipment GoShip reports rather than leaving it null. Postage drift on the buyer's own carrier, and the difference when the seller has to book a **backup carrier** because the buyer's no longer serves the route, are the platform's — funded by the rounding — and the buyer is told about the swap (`order_carrier_changed` notification, `carrier_changed_from`). `orders.shipping_carrier / parcel_preset / shipping_quote` are lifted from `metadata` by a `before insert` trigger because the order-creating RPCs copy a fixed column list; write them into `metadata` in the order spec, never as top-level fields.
- `npm run verify:shipping` checks the rounding, listing override, carrier filtering, seller charge and payout arithmetic with no network. Both verify scripts run under `node --experimental-strip-types`; `scripts/alias-loader.mjs` is what makes `@/…` imports resolve outside Next, and `.env` is parsed by hand because its tokens contain characters a shell would try to interpret.

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
