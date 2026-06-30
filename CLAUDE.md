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

All secrets live in `.env` (gitignored). Required keys span several integrations — Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), Cloudinary, Firebase (`NEXT_PUBLIC_FIREBASE_*`), eBay (`EBAY_*`), Groq (`GROQ_API_KEY`), Google GenAI (`GOOGLE_API_KEY`), PayOS (`PAYOS_*`), SMTP (`SMTP_*`), and GHN shipping (`GHN_TOKEN`, `GHN_SHOP_ID`). Many clients are lazy-initialized (e.g. `src/lib/payos.ts`) specifically so a missing key doesn't crash `next build`.

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
- **Groq** (`groq-sdk`) — vision/LLM for seller KYC verification (`/api/seller/ai-check` cross-checks Vietnamese CCCD ID front/back against a bank screenshot; prompts and user-facing messages are in Vietnamese) and soccer card identification (`/api/identify-soccer`). Route handlers do in-memory per-IP rate limiting.
- **Genkit + Google Gemini** (`src/ai/genkit.ts`, model `googleai/gemini-2.5-flash`) — flows under `src/ai/flows/` (e.g. `suggest-similar-sales.ts`). `src/ai/dev.ts` is the Genkit dev entry.

The card **scan** feature is credit-gated: `/api/scan/decrement-credit` plus `device-fingerprint.ts` track per-device usage (see `device_scan_usage` migration), and credits/passes are sold via PayOS (`PACKAGES` in `src/lib/payos.ts`).

### Payments & shipping (Vietnam-specific)
- **PayOS** (`src/lib/payos.ts`, `/api/payos/*`) — payment links, `webhook` and `return` handlers, credit/day-pass packages.
- **GHN — Giao Hàng Nhanh** (`src/lib/ghn.ts`, `/api/shipping`) — shipping rates/orders with card-envelope defaults; province/district/ward fields are stored on profiles.

### Pricing data
eBay sold-listing scraping (`/api/ebay-scrape`, `/api/search-ebay`, `cheerio` + `axios`) feeds market price comparisons. `/api/ebay-deletion` implements eBay's account-deletion notification endpoint (`EBAY_VERIFICATION_TOKEN`).

### Media
Images go through Cloudinary (`src/lib/cloudinary.ts`, `cloudinary-url.ts`) and/or Firebase storage (`src/lib/firebase.ts`). `next.config.ts` allows remote images from any HTTPS host.

### UI
shadcn/ui pattern: primitives in `src/components/ui` (Radix + `class-variance-authority` + `tailwind-merge` via `cn()` in `src/lib/utils.ts`). `components.json` configures the shadcn generator. Dark theme is forced (`<html className="dark">`). Custom fonts: Inter (body), Orbitron & Quantico (display).

**Category badge codes:** compact category badges/chips must display the standardized short code (e.g. "Bóng đá"/"Soccer"/"Football" → `SOC`; Pokémon → `POK`; One Piece → `OP`; Yu-Gi-Oh → `YGO`; Basketball → `NBA`; F1 → `F1`; Other/Khác → `OTH`). The single source of truth is `getCategoryCode()` in `src/lib/category-code.ts` — always import it (used by `card-item.tsx` and the product-detail related-cards rail) rather than re-deriving codes, so they stay consistent. Never render the raw localized category name inside a code-style badge.

**Category badge colors** mirror the navbar's per-category palette: **POK → yellow** (`bg-yellow-400` / dark text), **OP → red** (`bg-red-500`), **SOC → green** (`bg-green-500`), everything else → neutral (`bg-zinc-800`), each with a matching colored glow. The mapping lives in `categoryBadgeClass()` inside `src/app/cards/[id]/page.tsx` (NOT in `src/lib`, because Tailwind only scans `src/{app,components,pages}` for class names — color classes placed in `src/lib` won't be generated). Reuse/extend that mapping when adding category badges elsewhere.
