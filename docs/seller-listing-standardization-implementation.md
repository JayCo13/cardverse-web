# Seller Listing Standardization & VN Market Price — Implementation

> Implementation record for the spec in [`seller-listing-standardization.md`](./seller-listing-standardization.md).
> Scope: web app `cardverse-web` (Next.js 16 App Router + Supabase). All prices are stored in **VND**.

## 1. Goal

Standardize seller listing data so that:

1. **Every single-card listing is tied to exactly one catalog card** (via a canonical key:
   `tcgcsv_products.product_id` for Pokémon / One Piece, or `soccer_cards.id` for Soccer).
2. **Completed sales aggregate into a real Vietnamese market price** per card + condition, so the
   **scan → price** feature can show a VN price next to the eBay/TCGplayer price.

The root problem the spec identified: the old listing form lacked **collector number**, **language
(EN/JP)**, a **catalog link**, a **separate grading company/grade**, and a **finish/variant** — without
these, sales of the same card cannot be grouped, so no reliable VN price exists.

## 2. What was built

### 2.1 Data model — migration `supabase/migrations/20260613_seller_listing_standardization.sql`

**New columns on `cards`** (soft links — catalogs are externally crawled, no hard FKs):

| Column | Type | Notes |
|---|---|---|
| `catalog_product_id` | `integer` | `tcgcsv_products.product_id` (Pokémon EN/JP, One Piece) |
| `catalog_soccer_id` | `integer` | `soccer_cards.id` (Soccer catalog) |
| `card_number` | `text` | e.g. `199/197`, `OP15-118`, `TG12/TG30` |
| `language` | `text` | `'en'` \| `'jp'` \| `null` |
| `grading_company` | `text` default `'raw'` | `raw` \| `psa` \| `bgs` \| `cgc` \| `sgc` |
| `grade` | `numeric` | `1..10` (0.5 steps), `null` if raw |
| `finish` | `text` | `normal` \| `holo` \| `reverse` \| `1st` \| `parallel` |

Indexes: `idx_cards_catalog`, `idx_cards_catalog_soccer`.

**New table `vn_card_sales`** — one row per **completed** order of a standardized listing (the source
of truth for VN pricing). Only delivered + buyer-confirmed orders are recorded, so open asking prices
can never skew the market price.

```
id, catalog_product_id, catalog_soccer_id, card_id, category_id,
card_number, language, grading_company, grade, finish, price (VND), sold_at
```

- CHECK constraint: at least one of `catalog_product_id` / `catalog_soccer_id` is non-null.
- Indexes on both catalog keys + `grading_company, grade, finish, sold_at desc`.
- **RLS**: read-only for clients (`grant select` to anon/authenticated); writes happen server-side only.

**New view `vn_market_price`** — 90-day aggregate per card + grading + finish:

```sql
count(*) as sale_count,
percentile_cont(0.5) within group (order by price) as median_price,  -- median resists outliers
min(price), max(price), max(sold_at) as last_sold_at
```

Granted `select` to anon/authenticated.

**Types**: `src/lib/supabase/database.types.ts` updated — `cards` Row/Insert/Update gained the 7 new
columns; a full `vn_card_sales` table type was added.

### 2.2 Catalog search API — `src/app/api/catalog/search/route.ts` (new)

`GET /api/catalog/search?q=<name|number>&category=<pokemon-en|pokemon-jp|onepiece|soccer>`

- Auth required (`getUser`); catalog data itself is public.
- **Pokémon / One Piece**: queries `tcgcsv_products` with the **service-role client** — the same reason
  as `scan/pokemon-match`: anon roles hit the ~3s `statement_timeout` on un-indexed `number` lookups.
  Category map: `3` = Pokémon EN, `85` = Pokémon JP, `68` = One Piece.
- **Soccer**: queries `soccer_cards` (`search_name` / `card_number` ilike).
- Returns a normalized shape:

```ts
{ kind: 'tcgcsv' | 'soccer', productId?, soccerId?, name, setName, number,
  language: 'en'|'jp'|null, imageUrl, rarity, marketPrice? }
```

### 2.3 Catalog picker — `src/components/catalog-card-picker.tsx` (new)

A dialog distinct from the existing `CardPickerDialog` (which only picks from the seller's own
collection and has no catalog key). Two ways to identify the card:

1. **Text search** — tabs (Pokémon EN / Pokémon JP / One Piece / Soccer), debounced search (300ms)
   against `/api/catalog/search`, results show image, set, `#number`, language, rarity.
2. **Quick scan (📷 Quét ảnh)** — reuses the buyer scan pipeline:
   - Client-side image prep: HEIC → JPEG (`src/lib/heic.ts`), downscale to 1024px, JPEG base64.
   - Calls the **same `identify-card` edge function** the buyer scan uses.
   - From the AI result it **auto-switches to the right tab** (EN/JP by detected language, One Piece,
     Soccer) and **pre-fills the search box with the detected number/name**, so the seller just taps
     the correct candidate.
   - Rejects non-card photos; surfaces clear toasts on failure.
   - **No scan credit is consumed** — credit gating lives in the buyer's market-spotlight flow
     (`/api/scan/decrement-credit`); the `identify-card` function itself is free. Sellers standardizing
     a listing scan for free by design.

`onSelect(pick, tab)` returns the normalized `CatalogPick` (incl. `marketPrice` for tcgcsv cards).

### 2.4 Sell form — `src/app/sell/create/page.tsx`

**Part 1 — "Xác định đúng lá thẻ" (new):**
- The `CatalogCardPicker` button sits next to the existing collection picker.
- On pick, `handleCatalogPicked` sets `category`, `name`, `catalogProductId`/`catalogSoccerId`,
  `cardNumber`, `language` (derived from `category_id`: 3→en, 85→jp, OP→en, soccer→null), and the set
  name (mirroring the existing category effect timing).
- A **"selected card" card** shows the artwork + identity with a **Bỏ chọn** (clear) button.
- **Manual fallback fields** (`Số thẻ`, `Ngôn ngữ`) remain editable even after a pick — for cards not
  found in the catalog.
- **Price suggestion** (see 2.6) renders inside this card.

**Part 2 — "Tình trạng grade & biến thể" (new, replaces the old PSA checkbox):**
- `gradingCompany` select: `Raw | PSA | BGS | CGC | SGC`.
- If graded → `grade` slider `1..10` step `0.5` (defaults to 10 on first switch to graded).
- If raw → the existing `condition` select (`NM | LP | MP | HP`).
- `finish` select: `Normal | Holo | Reverse Holo | 1st Edition | Parallel`.
- **Back-compat**: on submit, `condition` is still set to a `"PSA 10"`-style string when graded, so any
  older UI that reads `condition` keeps working while the structured fields carry the truth.

**Parts 3 & 4 — unchanged:** the price section (incl. the USD/VND toggle + 5% withdrawal-fee notice
added earlier) and the images/description section are untouched.

**Zod schema (`getFormSchema`)** — added `catalogProductId`, `catalogSoccerId`, `cardNumber`,
`language`, `gradingCompany` (default `raw`), `grade`, `finish` (default `normal`). Validation rules:
- graded (`gradingCompany !== 'raw'`) → `grade` required.
- single card (not bundle) in Pokémon / One Piece / Soccer → `cardNumber` required.
- single card in Pokémon / One Piece → `language` required.
- bundles are exempt from all of the above.

**Submit (`submitListing`)** — maps the new fields into the `cards` insert
(`catalog_product_id, catalog_soccer_id, card_number, language, grading_company, grade, finish`);
bundles store `null` for the per-card identity fields.

### 2.5 Write path — `src/app/api/marketplace/orders/route.ts` (`confirm` action)

When a buyer confirms receipt (order → `completed`, seller wallet credited), the route now also records
the sale for VN pricing:

- Reads the sold `card`'s standardization fields.
- Only writes if it's **not a bundle** and has a `catalog_product_id` **or** `catalog_soccer_id`.
- Inserts `vn_card_sales` with the **service-role client** (the table is read-only to clients via RLS),
  using `price = order.amount` (the real sale price — for offer-based escrow orders this is the agreed
  offer price) and `category_id` derived from category + language (3 / 85 / 68 / 99).
- Wrapped in `try/catch` — a pricing-write failure can never break order confirmation.

### 2.6 Read path — VN price display

**Component `src/components/vn-market-price.tsx` (new):** queries the `vn_market_price` view by
`catalog_product_id` (or `catalog_soccer_id`), aggregates the grading/finish buckets into one headline
(sale-count-weighted median), and renders:

```
🇻🇳 Giá thị trường VN: 1.200.000đ
N giao dịch · 900.000đ–1.500.000đ · cập nhật 3 ngày trước
```

Renders **nothing** when there are no recorded sales — safe to drop anywhere.

Mounted in two places:
- **`src/components/market-spotlight.tsx`** — under the scanned card's price header, so the buyer scan
  shows the VN price next to the existing price/chart.
- **The sell form's "selected card" block** — so the seller sees the live VN market price for the card
  they're listing.

**Price suggestion in the sell form (bonus):** for tcgcsv cards (Pokémon / One Piece), the selected-card
block also shows the catalog's TCGplayer **market price (USD) converted to VND**
(`USD_TO_VND_RATE = 25,450`, rounded to the nearest 1,000đ) with a **"Dùng giá này"** button that fills
the price field (toggling the currency back to VND). The seller can still edit it. Soccer has no catalog
price, so only the VN market price shows when available.

## 3. Files

**Added**
- `supabase/migrations/20260613_seller_listing_standardization.sql`
- `src/app/api/catalog/search/route.ts`
- `src/components/catalog-card-picker.tsx`
- `src/components/vn-market-price.tsx`

**Modified**
- `src/app/sell/create/page.tsx` — Part 1 (catalog picker + identity fields + price suggestion),
  Part 2 (grading/finish), zod schema, submit mapping. (Old PSA checkbox/slider removed.)
- `src/app/api/marketplace/orders/route.ts` — `confirm` action writes `vn_card_sales`.
- `src/components/market-spotlight.tsx` — renders `VnMarketPrice`.
- `src/lib/supabase/database.types.ts` — `cards` + `vn_card_sales` types.

## 4. Impact on prior work (escrow / chat / wallet branch)

**No conflicts — additive only.** The only shared file is `sell/create/page.tsx`, where the new Part 1/2
sit above the unchanged price section. The escrow offer flow is actually **synergistic**: offer-based
orders go through the same order pipeline, so when a buyer confirms one, `vn_card_sales` is fed with the
real agreed offer price.

## 5. Verification

1. Run the migration in Supabase; `npx tsc --noEmit` on the changed files shows no new errors
   (the repo's pre-existing `orders/route.ts` `never`-type errors are unrelated and predate this work).
2. `npm run dev` → `/sell/create`:
   - Open the catalog picker, **Quét ảnh** a Pokémon card → tab + search auto-fill → pick the candidate
     → identity fields fill and the price suggestion appears.
   - Choose `PSA` grade `10` + `Holo` → submit → the `cards` row has
     `catalog_product_id, card_number, language, grading_company='psa', grade=10, finish='holo'`,
     `condition='PSA 10'`.
3. Buy that card (wallet) → seller ships → buyer confirms → one `vn_card_sales` row with the right
   `catalog_product_id` and `price = order.amount`.
4. Scan the same card → the **🇻🇳 Giá thị trường VN** block shows the median. A card with no VN sales
   shows nothing (no error).
5. Soccer: pick from the Soccer tab → `catalog_soccer_id` stored; completed order → `vn_card_sales` row
   with `catalog_soccer_id`.
6. Regression: USD/VND toggle + confirm dialog + 5% withdrawal notice still work; bundles skip
   standardization.

## 6. Notes / follow-ups

- **TCGplayer price suggestion** is USD-only data from the catalog; Soccer cards have no catalog price.
- **Soccer scan read path**: the buyer scan's soccer flow (`identify-soccer-card`) must surface a
  `soccer_cards.id` to query `vn_market_price` by `catalog_soccer_id` — wire this when that id is
  available end-to-end.
- The exchange rate is a single hardcoded constant (`USD_TO_VND_RATE` in
  `src/contexts/currency-context.tsx`); swap for a live rate source if needed.
