# Plan: Tối ưu SEO / AEO / GEO cho cardversehub.com

_Ngày lập: 2026-09-21. Số liệu trong phần Context được lấy từ site live và Supabase tại ngày lập._

## Trạng thái

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 0 — thủ công | **Chờ user** | GSC, Bing Webmaster, GA4, điền `NEXT_PUBLIC_FACEBOOK_URL` / `NEXT_PUBLIC_ZALO_URL` (+ `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_GA_ID`) vào `.env` và Netlify |
| 1 — nền tảng kỹ thuật | **Code xong; chờ nghiệm thu production** | `/users/[id]` đã có hồ sơ/listing trong HTML ẩn danh; `/sell` bị loại khỏi sitemap; các route SEO khác đã qua kiểm tra local |
| 2 — lớp trả lời AI | **Code xong; chờ nghiệm thu production** | `/help` có toàn bộ câu hỏi và câu trả lời trong HTML ban đầu, khớp FAQPage; FAQ thanh toán/vận chuyển được sửa ở vi/en/ja |
| 3 — catalog pilot | **Đã code pilot; chờ migration + production** | Có route card/set, sitemap index phân mảnh, redirect URL cũ; chưa mở toàn bộ catalog 46k |
| 4 — nội dung / PR | Chưa làm | Không code |

Phát hiện khi triển khai: `AuthReady` (`src/components/auth-ready.tsx`) chỉ render body server-side cho route trong `PUBLIC_PREFIXES` — route public mới **phải** thêm vào đó, nếu không HTML chỉ có header/footer.

## Context

Trang đã rank tốt cho brand query "cardversehub" và AI Overview trích dẫn đúng, nhưng research live site (curl như Googlebot + query Supabase) cho thấy Google **không thấy được bất kỳ listing nào**:

- `robots.txt` và `sitemap.xml` → 404.
- Cả site chỉ có 1 bộ metadata ở `src/app/layout.tsx`; `/pokemon`, `/cards/[id]`, `/help`… đều cùng title/description.
- `src/components/card-item.tsx` điều hướng bằng `router.push('/cards/${id}')` (dòng 145, 241) → HTML `/buy` không có `<a href="/cards/…">` nào → Googlebot không có đường tới trang thẻ.
- `src/app/cards/[id]/page.tsx` (1.535 dòng) là `"use client"` toàn bộ, fetch trong `useEffect` → HTML trả về không có tên thẻ / giá / ảnh / h1.
- `<html lang="en">`, ngôn ngữ mặc định `'en-US'` (`src/contexts/currency-context.tsx:113`) trong khi khách là người Việt → query tiếng Việt không match; AI Overview đang phải tự dịch.
- 0 JSON-LD (không Organization / Product / FAQPage / BreadcrumbList).
- 15 câu FAQ tiếng Việt (`help_faq_1..15` trong `src/lib/i18n/vi.ts`) bị khoá trong client component.
- Kho catalog TCGCSV **27.564 thẻ Pokémon EN (214 set) + 18.850 One Piece** có giá thị trường, nhưng chỉ hiện trong 1 trang client có filter, không có URL riêng cho set/thẻ nào → bỏ phí toàn bộ long-tail "giá thẻ X".

Số liệu: 35 listing active, 11 seller verified. Social URL (`NEXT_PUBLIC_FACEBOOK_URL`, `NEXT_PUBLIC_ZALO_URL`) chưa set trong `.env`. Địa chỉ pháp lý đã có trong Terms: 48A Thị Mười, Q.12, TP.HCM · cardversehub.vn@gmail.com · +84 812 334 511.

Mục tiêu: một lớp SEO dùng chung (entity + metadata + JSON-LD) để Google, AI Overview (AEO) và ChatGPT/Perplexity (GEO) đọc cùng một nguồn; mở khoá trang thẻ và catalog cho crawler; giữ nguyên toàn bộ tương tác client hiện có.

**Không làm trong plan này:** i18n routing `/en/...` (hreflang cần URL riêng cho từng ngôn ngữ — hiện 1 URL toggle 3 ngôn ngữ, đổi là dự án lớn, để sau). Blog / digital PR là việc nội dung, không code.

---

## Phase 0 — Việc thủ công (user làm, không code) — 30 phút

1. Google Search Console: add property `cardversehub.com`, verify qua DNS TXT trên Cloudflare (hoặc lấy meta tag → dán vào env `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`).
2. Bing Webmaster Tools: import từ GSC (1 click). ChatGPT search dùng index Bing.
3. GA4: tạo property, lấy `G-XXXX` → env `NEXT_PUBLIC_GA_ID`.
4. Điền `NEXT_PUBLIC_FACEBOOK_URL`, `NEXT_PUBLIC_ZALO_URL` (+ TikTok/YouTube nếu có) vào `.env` và Netlify env — footer đã đọc sẵn 2 key này (`src/components/layout/footer.tsx:76-90`), Organization JSON-LD sẽ dùng làm `sameAs`.

---

## Phase 1 — Nền tảng kỹ thuật (P0) — ~1 ngày

### 1.1 Lớp SEO dùng chung — `src/lib/seo/`
- `site.ts` — **entity duy nhất**: `SITE_URL` (đọc `NEXT_PUBLIC_SITE_URL`, fallback như layout hiện tại), tên, mô tả vi + en, logo `/assets/og-logo.jpg`, địa chỉ/email/phone (lấy từ Terms), `sameAs` build từ các env social đang có. Mọi thứ khác (layout, Organization, llms.txt, about) import từ đây — không hard-code lại.
- `metadata.ts` — `buildMetadata({ title, description, path, image?, noIndex? })` trả `Metadata` có `alternates.canonical`, openGraph, twitter; title dạng `"<Tên trang> | CardVerseHub"`. Chuyển `SITE_TITLE`/`SITE_DESCRIPTION`/`OG_IMAGE` hiện có trong `layout.tsx:47-53` sang đây.
- `jsonld.tsx` — `<JsonLd data={...} />` render `<script type="application/ld+json">`, và builder: `organizationJsonLd()`, `websiteJsonLd()` (kèm `SearchAction` trỏ `/buy?q={search_term_string}`; trang Mua đọc `q`), `productJsonLd(card)`, `breadcrumbJsonLd(items)`, `faqJsonLd(items)`.

### 1.2 Root layout — `src/app/layout.tsx`
- `lang="vi"`; `metadata` dùng `buildMetadata`, thêm `verification.google` từ env.
- Chèn `organizationJsonLd()` + `websiteJsonLd()` trong `<body>`.
- GA4 qua `next/script` (`afterInteractive`) chỉ khi `NEXT_PUBLIC_GA_ID` có.
- Ngôn ngữ mặc định `'en-US'` → `'vi-VN'` ở `currency-context.tsx:113,124` (chỉ khi localStorage chưa có preference — logic đọc localStorage/`localChosenAt` giữ nguyên). Kiểm tra `LOCALE_MAP` và mọi chỗ so sánh `=== 'en-US'` không bị phụ thuộc default.

### 1.3 `robots.ts` + `sitemap.ts` — `src/app/`
- `robots.ts`: allow `/`; disallow `/api/`, `/account`, `/wallet`, `/orders`, `/checkout`, `/cart`, `/offers`, `/transaction`, `/profile`, `/sell/edit`, `/auth`, `/reset-password`, `/update-password`, `/bid`, `/razz`, `/forum` (đang beta 307); `sitemap: ${SITE_URL}/sitemap-index.xml`.
- `sitemap.ts` (dùng `createServerSupabaseClient` hoặc anon client — RLS cho phép đọc): static routes (`/`, `/buy`, `/pokemon`, `/onepiece`, `/soccer`, `/sold`, `/pricing`, `/help`, `/contact`, `/terms`, `/privacy`, `/about`; không đưa `/sell` cần đăng nhập vào sitemap) + `cards` với `status='active'` và `listing_visibility='visible'` (`lastModified` từ `updated_at`) + `profiles` có `seller_verified=true`, `display_name` không rỗng và ít nhất một listing công khai còn active → `/users/[id]` sau khi route có HTML công khai từ server.
- Phase 3 dùng `generateSitemaps` riêng tại `src/app/catalog/sitemap.ts`; `sitemap-index.xml` trỏ cả sitemap marketplace và catalog.

### 1.4 Link crawl được — `src/components/card-item.tsx`
- Bọc vùng ảnh + tên (khu vực đang `onClick={handleDetailClick}` dòng ~430 và ~523) bằng `<Link href={`/cards/${card.id}`}>` của `next/link`; giữ `handleActionClick` cho các nút Buy/Bid/Ticket. `UserLink` đã có `stopPropagation` — kiểm tra nested `<a>` không lồng nhau (Link ngoài không được bao `UserLink`; nếu bao thì tách vùng).
- Grep thêm các grid khác dùng `router.push('/cards/')` (`popular-cards`, `soccer-cards`, `onepiece-cards`, `market-spotlight`) và áp cùng pattern.

### 1.5 Trang thẻ SSR — `src/app/cards/[id]/`
- Đổi tên file hiện tại thành `card-detail-client.tsx` (giữ `"use client"`, giữ toàn bộ logic), nhận prop `initialCard?: Card` để `useState(initialCard ?? null)` và bỏ loading state khi có sẵn → HTML SSR chứa tên/giá/ảnh.
- `page.tsx` mới (server): fetch 1 query `cards` + `profiles(display_name, seller_verified…)` bằng `createServerSupabaseClient` (`src/lib/supabase/server.ts`), map bằng `mapSaleCard` (`src/app/buy/map-sale-card.ts` — đã là mapper dùng chung server/client).
  - `generateMetadata`: title `"<tên thẻ> – <giá VND> | CardVerseHub"`, description từ `description`/category/condition/seller, OG image = `image_url` (fallback logo). Listing không public dùng metadata chung và `noindex`, không đưa dữ liệu thẻ vào HTML server; client tiếp tục kiểm tra quyền của chủ listing. Listing sold/no-longer-active vẫn `noindex`.
  - Render `productJsonLd(card)` (`Product` + `Offer` giá VND, `availability` theo `status`, `itemCondition`, `seller` = Organization/Person) + `breadcrumbJsonLd` (Trang chủ › Mua › <category> › tên).
- Lưu ý: `listing_visibility` check hiện có ở client so với `viewerId` — server chỉ quyết định **index hay không**, không thay đổi ai được xem.

### 1.6 Metadata riêng cho từng route
Pattern: route đã có layout server (`pokemon/layout.tsx`, `onepiece/layout.tsx`, `soccer/layout.tsx`, `buy/page.tsx`) → thêm `export const metadata = buildMetadata(...)`. Route là client page (`sell`, `help`, `pricing`, `contact`, `terms`, `privacy`, `sold`, `collection`, `users/[id]`) → thêm `layout.tsx` mỏng chỉ export metadata (với `users/[id]` dùng `generateMetadata` fetch `display_name`).
Title/description **tiếng Việt**, có keyword: "Mua thẻ Pokémon, One Piece, bóng đá chính hãng", "Bán thẻ bài…", "Giá thẻ Pokémon TCG…".

### 1.7 Lặt vặt
- `src/components/hero-section.tsx`: `<h2>` trùng text với `<h1>` "CardVerseHub" → đổi thành `<p aria-hidden>` hoặc `<span>` (glitch effect layer).
- `public/llms.txt`: markdown mô tả site (đọc nội dung từ `site.ts` — sinh tĩnh 1 lần, hoặc `app/llms.txt/route.ts` trả `text/plain`).

---

## Phase 2 — Lớp trả lời cho AI (AEO/GEO) — ~0.5 ngày

### 2.1 `/help` SSR + FAQPage
- `src/app/help/page.tsx` render `HelpClient`; client component này được server-render thành 15 Q/A tiếng Việt trong HTML ban đầu bằng `<details open>` cùng FAQPage JSON-LD. Khi khách đổi ngôn ngữ, Q/A và JSON-LD cập nhật cùng nhau.
- Bỏ `ThemeProvider` cục bộ (dark đã force ở root).

### 2.2 `/about` — trang entity
- `src/app/about/page.tsx` (server): 1 đoạn "CardVerseHub là…" 40–60 từ, tiếp theo là: sản phẩm chính, cách hoạt động (escrow, ship live), địa chỉ/liên hệ, năm thành lập, link social. Nội dung đọc từ `site.ts` để **đồng nhất 100%** với bio Facebook/Zalo/TikTok (user copy cùng đoạn đó ra ngoài).
- Thêm link `/about` vào footer (`footer.tsx`).

### 2.3 Trang category có đoạn trả lời
- Đầu `/pokemon`, `/onepiece`, `/soccer`: 1 đoạn `<p>` tiếng Việt SSR (trong layout, phía trên `children`) trả lời "Mua thẻ X ở đâu / giá bao nhiêu" — text ngắn, không phá layout.

---

## Phase 3 — Programmatic SEO từ catalog TCGCSV (P1, pilot đã triển khai)

Dữ liệu: `tcgcsv_products` (`product_id, category_id, group_id, name, image_url, set_name, number, rarity, market_price, low_price, extended_data, tcgplayer_url`), views `pokemon_sets_en` / `pokemon_sets_jp` (214 set EN). One Piece `category_id=68`.

- Đã triển khai pilot server-side với route động và cache dữ liệu catalog 1 ngày. Trang card truy vấn listing đang bán theo từng request để Offer JSON-LD và giá không giữ bản ISR cũ:
  - `/pokemon/set/[slug]` và `/onepiece/set/[slug]` — slug dạng ID-tên set; list 60 thẻ/trang, pagination qua `?page=`, giá tham khảo và Breadcrumb JSON-LD. Vì đọc `searchParams`, HTML render theo request; group, danh sách thẻ theo trang và điều kiện pilot dùng cache dữ liệu 1 ngày.
  - `/pokemon/card/[productId]-[slug]` — tên, set, số, rarity, `extended_data` (HP, type, card text), ảnh, **giá thị trường USD + quy đổi VND** (dùng cùng rate trong `src/lib/exchange-rate.ts`), khối "Đang bán trên CardVerseHub" (query `cards.catalog_product_id` theo trạng thái active/visible/sale) + CTA "Bán thẻ này" → `/sell`. Không `generateStaticParams`; thông tin catalog cache 1 ngày, listing đọc mới mỗi request.
  - Cùng pattern cho `/onepiece/set/…` và `/onepiece/card/…`; URL cũ `/products/[id]` trả 308 về URL canonical.
- JSON-LD: `Product` (+ `Offer` chỉ khi có listing sale thật đang active/visible; nếu không thì không xuất Offer), `BreadcrumbList`. Giá tham khảo được hiển thị trong nội dung trang, tách khỏi giá chào bán.
- Trang `/pokemon` hiện tại: thẻ trong grid link tới `/pokemon/card/…` (thay vì chỉ mở TCGplayer).
- `src/app/catalog/sitemap.ts` → 3 sitemap pilot (`/catalog/sitemap/0.xml` … `/2.xml`) với khoảng 3.000 product URL và set URL; `sitemap-index.xml` trỏ cả sitemap cũ và catalog. Sản phẩm ngoài pilot vẫn có route nhưng `noindex`.
- Pilot hiện giới hạn theo khoảng ID quan sát được trong dữ liệu hiện tại (Pokémon EN/JP và One Piece), chưa phải toàn bộ 46k sản phẩm. Mở rộng range sau khi đo lỗi query và index coverage production.
- Trước deploy phải apply `supabase/migrations/20260923000100_catalog_seo_lookup_indexes.sql` trên Supabase production.
- Dữ liệu catalog là public (anon RLS) nên dùng anon client trong server component, không cần service role.

---

## Phase 4 — Không code (song song)
- Blog (khi mở): 5–10 bài đầu tiếng Việt: phân biệt thẻ thật/giả, PSA/BGS là gì, cách bảo quản, top thẻ tăng giá theo set.
- Citations: đăng bài giới thiệu trên group FB thẻ bài VN, Voz, TikTok; xin listing trên các trang "sàn thẻ bài Việt Nam". Mỗi tuần hỏi ChatGPT/Perplexity/Gemini "mua thẻ Pokémon ở Việt Nam ở đâu" và ghi kết quả.

---

## Thứ tự thực hiện
1. Phase 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 (mỗi bước 1 commit).
2. Phase 2.
3. Phase 3 đã code pilot cùng Phase 1–2; trước deploy cần apply migration index catalog, rồi nghiệm thu các phase trên production và submit sitemap index.

## Verification
- `npx tsc --noEmit` và `npm run build` sạch.
- Local: `curl -s localhost:3000/robots.txt`, `/sitemap.xml` có URL `/cards/<id>`; `curl -s localhost:3000/cards/<id> | grep -o '<title>[^<]*'` ra tên thẻ; `grep -c 'ld+json'` ≥ 2; `curl -s localhost:3000/buy | grep -c 'href="/cards/'` > 0; `/help` HTML chứa câu hỏi FAQ tiếng Việt và `FAQPage`.
- Dán JSON-LD vào validator.schema.org và Rich Results Test (Product, FAQPage, Organization, Breadcrumb) không lỗi.
- Thử toggle ngôn ngữ EN/JA vẫn hoạt động; card grid vẫn click mở detail, nút Buy vẫn mở checkout, `UserLink` không bị nested `<a>` (console không warn).
- Sau deploy: submit sitemap trong GSC + Bing; sau 3–7 ngày kiểm tra "Pages → Indexed"; Screaming Frog crawl 500 URL để bắt title trùng.
- Phase 3 pilot đã kiểm tra local: `/pokemon`, `/onepiece`, route card/set, redirect `/products/[id]`, sitemap partitions và sản phẩm ngoài pilot `noindex`; build/tsc/lint/diff đều đạt. `/help` đã kiểm tra bằng trình duyệt với VI/EN/JA: câu trả lời và FAQPage JSON-LD đổi cùng nhau. Còn phải apply migration, deploy, submit `sitemap-index.xml` lên GSC/Bing và kiểm tra Rich Results/production.
