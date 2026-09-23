# Review: SEO / AEO / GEO — Phase 1 + 2

_Ngày: 2026-09-21; xử lý findings review trên `main` ngày 2026-09-23. Chưa commit. Kế hoạch gốc: `docs/seo-aeo-geo-plan.md`._
_Các thay đổi tracking đã được commit riêng, không thuộc change set SEO._

## Mục tiêu

Trước thay đổi, Google không thấy được listing nào: không `robots.txt`/`sitemap.xml`, card grid điều hướng bằng `router.push` (không có `<a href>`), `/cards/[id]` client-render 100% (HTML không có tên/giá/ảnh), cả site dùng chung 1 title, HTML `lang="en"` cho khách Việt, 0 JSON-LD. Change set này sửa toàn bộ các điểm đó **mà không đổi hành vi tương tác** của trang.

## Thay đổi theo nhóm

### A. Lớp SEO dùng chung — `src/lib/seo/` (mới)
| File | Vai trò |
|---|---|
| `site.ts` | Entity duy nhất: `SITE_URL`, tên, mô tả vi/en, `ORGANIZATION` (địa chỉ/email/phone — copy từ Terms), `socialProfiles()` đọc `NEXT_PUBLIC_{FACEBOOK,ZALO,TIKTOK,YOUTUBE,INSTAGRAM}_URL`, `absoluteUrl()` |
| `metadata.ts` | `buildMetadata({ title, description, path, image, imageAlt, noIndex, type })` → `Metadata` với canonical, OG, Twitter, robots |
| `jsonld.tsx` | `<JsonLd>` (escape `<` → `<`), `organizationJsonLd`, `websiteJsonLd` (SearchAction `/buy?q=`), `breadcrumbJsonLd`, `faqJsonLd`, `productJsonLd(card)` |

**Điểm cần soi:**
- `productJsonLd`: chỉ thêm `offers` khi `listingType === 'sale' && price > 0` (auction/razz không có Offer giả). `itemCondition` map `Mint`/`Hoàn hảo` → NewCondition, còn lại Used. `availability` theo `status`. Giá là VND (xác nhận: trang thẻ dùng `formatVND(card.price)`, `priceIsVnd: true`).
- `websiteJsonLd` khai `SearchAction` trỏ `/buy?q={search_term_string}`. Đã nối `q` vào bộ lọc tìm kiếm ở `/buy`, kể cả HTML đầu tiên và khi đổi URL trong cùng phiên. Google đã ngừng hiển thị sitelinks search box; khai báo này không được xem là cam kết có rich result ([Google Search Central](https://developers.google.com/search/blog/2024/10/sitelinks-search-box)).
- `buildMetadata` luôn set `metadataBase` — trùng với root nhưng vô hại.

### B. Root layout — `src/app/layout.tsx`
- `lang="en"` → `lang="vi"`. Metadata gốc dùng `buildMetadata({ path: '/' })` + keywords/icons/`verification.google` (chỉ khi có `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`).
- Chèn `<JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />` và GA4 qua `next/script` `afterInteractive` (chỉ khi có `NEXT_PUBLIC_GA_ID`).
- `SITE_TITLE`/`SITE_DESCRIPTION`/`OG_IMAGE` cũ bị xoá khỏi layout, chuyển sang `site.ts`.

### C. Ngôn ngữ mặc định — `src/contexts/currency-context.tsx`
- `DEFAULT_LANGUAGE` `'en-US'` → `'vi-VN'`; `useState`/`useRef` khởi tạo từ hằng này thay vì literal.
- Logic localStorage / account-locale reconcile **không đổi**. User đã lưu `en-US` vẫn được switch sau hydrate như trước.
- **Cần soi:** có chỗ nào khác giả định mặc định là `en-US` không (email locale fallback `getOfferEmailRecipient`, `LOCALE_MAP` fallback)? Mình grep không thấy phụ thuộc, nhưng đáng xác nhận. Currency mặc định vẫn `USD` — ngoài scope, cân nhắc đổi `VND` sau.

### D. Crawl — `src/app/robots.ts`, `src/app/sitemap.ts` (mới)
- `robots`: disallow `/api/`, account/wallet/orders/checkout/cart/offers/transaction/profile/collection, `/sell/edit/`, `/auth/`, reset/update-password, `/bid` `/razz` `/forum` (đang beta 307).
- `sitemap`: `force-dynamic` (dùng `createServerSupabaseClient` có cookies nên không prerender được). Query `cards` `status=active` + `listing_visibility=visible` (limit 5000) và `profiles` `seller_verified=true` (limit 1000), chỉ thêm người bán có `display_name` không rỗng và ít nhất một listing active/visible. Nếu một query lỗi, sitemap ghi log và trả lỗi để không công bố XML thiếu URL động. Đã bỏ `/sell` vì SSR của khách ẩn danh chỉ có skeleton trong lúc kiểm tra auth, rồi `PageAuthGate` hiện lời mời đăng nhập.
- `/users/[id]/page.tsx` nay query cột hồ sơ công khai và listing visible ở server, truyền dữ liệu đầu tiên cho `profile-client.tsx`; `AuthReady` cho `/users` render body khi auth còn đang resolve. Không chọn email, số điện thoại, địa chỉ hoặc dữ liệu ví. Người bán thiếu tên không vào sitemap; metadata của tài khoản chưa xác minh vẫn `noindex`.

### E. Link thật trong grid — `src/components/card-item.tsx`
- Hai `<h3>` tiêu đề (list view ~dòng 521, grid view ~dòng 783) bọc `<Link href="/cards/{id}">`, bỏ `onClick={handleDetailClick}` và `cursor-pointer` trên `<h3>`. Ảnh và nút vẫn `router.push` như cũ.
- **Cần soi:** `<Link>` không nằm trong `UserLink`/`<a>` nào (đã kiểm tra thủ công, nhưng đáng xác nhận không có nested anchor warning trong console). Card có `onClick` ở wrapper nào không để click title fire 2 lần? Mình thấy `Card` wrapper không có onClick.

### F. Trang thẻ SSR — `src/app/cards/[id]/`
| File | Thay đổi |
|---|---|
| `page.tsx` (mới, server) | `force-dynamic`. `loadCard` (React `cache`) query `cards` + `profiles` bằng server client, validate UUID. `generateMetadata`: title `"<tên> – <giá VND>"`, description từ `description` (cắt 140 ký tự) hoặc category/set/condition, OG image = ảnh thẻ. `noIndex` nếu không `visible` hoặc `status !== 'active'` hoặc không tìm thấy. Render `Product` + `BreadcrumbList` JSON-LD chỉ khi indexable. |
| `card-detail-client.tsx` | = `page.tsx` cũ đổi tên (`git mv`, 1.535 dòng). Đổi: `CardDetailsPage()` → `CardDetailClient({ initialCard })`; `useState(initialCard)`, `isLoading = initialCard === null`, `activeImage` khởi tạo từ `initialCard`; **bỏ `setIsLoading(true)` ở đầu `fetchCard`** để không flash skeleton đè lên nội dung SSR. Toàn bộ logic còn lại (visibility redirect, sold → `/sold`, offers, realtime, checkout) nguyên vẹn. |
| `map-card.ts` (mới) | `mapCard` tách ra khỏi client file để server import được (client module "use client" không export được hàm thường cho server). Nội dung y hệt bản cũ. |

**Cần soi kỹ nhất:**
- Hydration: server render với `initialCard` + `isLoading=false`; client first render phải khớp. `user` lúc SSR là null, client cũng null ở first render (auth provider async) → giống trước. Nếu reviewer thấy chỗ nào render phụ thuộc `localStorage`/`window` ngoài `useEffect` thì báo.
- Bảo mật: RLS hiện cho anon đọc `cards` khá rộng. Đã chặn tên, giá, ảnh của listing `hidden`/`deleted` khỏi metadata và HTML SSR; chủ listing vẫn đi qua bước tải client và kiểm tra quyền như trước. Chưa thay đổi RLS hoặc API đọc card trong phạm vi SEO này.
- `describe()` cắt description bằng regex `\s+\S*$` — với description một từ dài không có khoảng trắng > 140 ký tự sẽ ra chuỗi rỗng phần lead → vẫn có `price`/`seller` suffix, chấp nhận được.

### G. Metadata từng route
- Layout mỏng mới (chỉ export `metadata` + return children): `sell`, `help`, `pricing`, `contact`, `terms`, `privacy`, `sold`, `complaints`, `collection` (noIndex), `users/[id]` (`generateMetadata` fetch `display_name`, noIndex nếu không `seller_verified`).
- `pokemon`/`onepiece`/`soccer/layout.tsx`: thêm `metadata` + render `<CategoryAnswerSection>` **sau** `{children}`.
- `buy/page.tsx`: thêm `export const metadata`.
- Đã đặt đoạn trả lời category trực tiếp trên `/soccer`; `/soccer/[id]` không còn nhận nội dung không liên quan từ layout cha.

### H. AEO — `src/app/help/`, `src/app/about/`, `src/components/seo/category-answer.tsx`
- `help/page.tsx` (server) render `<HelpClient />`; `help-client.tsx` server-render 15 Q/A và FAQPage JSON-LD cùng một danh sách dịch từ `faqs.ts`. HTML ban đầu là tiếng Việt; khi đổi EN/JA, cả câu trả lời lẫn JSON-LD cập nhật theo locale. FAQ vẫn tìm kiếm/thu gọn được. **Bỏ `ThemeProvider` cục bộ** (`next-themes`, `defaultTheme="system"`) vì dark đã force ở root. FAQ 5 và 8 sửa theo mốc giải ngân 72 giờ và quyền chọn hãng của người mua ở cả vi/en/ja.
- `about/page.tsx`: server, nội dung tiếng Việt hard-code (`FACTS`), liên hệ từ `ORGANIZATION`, social từ env. Đã sửa câu ký quỹ để bao gồm mốc 72 giờ sau khi hãng xác nhận giao thành công; bỏ khẳng định phí ship bằng đúng giá hãng vì checkout làm tròn. Phí rút 10% khớp migration hiện tại; số lượng catalog 27.000/18.000 là mốc khảo sát 2026-09-21 và cần kiểm tra lại trước khi công bố lâu dài.
- i18n: thêm `page_about_title` vào `en`/`ja`/`vi` (bắt buộc cả 3). Footer thêm link `/about` đầu cột Support.
- `category-answer.tsx`: text tiếng Việt cố định (không qua `t()`), render server. Người dùng EN/JA sẽ thấy đoạn này tiếng Việt — chấp nhận vì mục tiêu là crawler, nhưng reviewer cân nhắc.

### I. Fix phát hiện khi làm — `src/components/auth-ready.tsx`
- `PUBLIC_PREFIXES` thiếu `/about` → SSR chỉ có header/footer, body bị thay bằng skeleton. Đã thêm. **Quy tắc mới (ghi trong CLAUDE.md):** route public mới phải thêm vào đây.

### J. Khác
- `hero-section.tsx`: slide 2+ dùng `<p>` thay `<h2>` (tránh `<h2>CardVerseHub</h2>` trùng `<h1>`). Class/style/`data-text` giữ nguyên.
- `src/app/llms.txt/route.ts`: `force-static`, revalidate 1 ngày, nội dung từ `site.ts`.
- `CLAUDE.md` + `AGENTS.md`: mục "SEO / structured data" mới; sửa đường dẫn `categoryBadgeClass()` → `card-detail-client.tsx`.

## Đã verify (local, `npm run build` + `npm run start` port 3123)
- `npx tsc --noEmit` sạch; `eslint` trên file mới: 0 error (warning là có sẵn).
- `robots.txt` 200; sitemap local ngày 2026-09-23 có 62 URL (13 tĩnh + 41 cards + 8 users), không có `/sell`; `llms.txt` 200. Số lượng động phụ thuộc dữ liệu DB.
- `/buy` có 15 `href="/cards/…"`; trước: 0.
- `/cards/<id>`: title `"Lamine Yamal Rookie #64 Topps Chrome – 1.179.000 ₫ | CardVerseHub"`, `<h1>` tên thẻ trong HTML, `og:image` = Cloudinary, JSON-LD Organization/WebSite/Product(price 1179000)/BreadcrumbList; `/cards/not-a-uuid` → `noindex`.
- `/help` có `FAQPage`, đủ 15 `<details open>` và nội dung câu trả lời 5/8 trong HTML ẩn danh; `/about` có body; cả 8 URL `/users/<id>` trong sitemap đều trả 200 và có `<h1>` tên gian hàng, link tới listing, không có skeleton `aria-busy` trong body HTML ẩn danh; `/collection` noindex.
- Sau khi xử lý review: `npx tsc --noEmit`, `npm run lint -- --quiet`, `git diff --check`, `git diff --cached --check` và `npm run build` đều đạt. Build trong sandbox bị chặn tải Google Fonts; build lại với mạng được phép đã đạt, nên đây không phải lỗi code.
- Home: `<html lang="vi">`, 0 `<h2>CardVerseHub</h2>`.

## Chưa verify
- Giao diện thực tế trên trình duyệt (Chrome extension không kết nối) — cần mở `/about`, cuối `/pokemon`, 1 trang thẻ, đổi ngôn ngữ EN/JA, click title/ảnh/nút Buy trong grid, xem console không có warning nested `<a>` hoặc hydration mismatch.
- Rich Results Test / validator.schema.org với JSON-LD từ trang thẻ và `/help`.
- Netlify: `force-dynamic` sitemap và `llms.txt` `force-static` chạy đúng qua `@netlify/plugin-nextjs`.
- Production: chưa xác nhận crawl/index thực tế hay Rich Results Test; không coi kết quả local là đã deploy.

## Cập nhật Phase 3 pilot (2026-09-23)

- Đã thêm route server-rendered cho `/pokemon/card/*`, `/pokemon/set/*`, `/onepiece/card/*`, `/onepiece/set/*`; `/products/[id]` redirect 308 về URL catalog canonical.
- Đã thêm `sitemap-index.xml` và 3 catalog sitemap partition. Pilot hiện xuất khoảng 3.000 product URL cùng các set URL; sản phẩm ngoài pilot vẫn trả route nhưng `noindex` để tránh quảng bá nội dung chưa nằm trong sitemap.
- Đã thêm migration lookup index `supabase/migrations/20260923000100_catalog_seo_lookup_indexes.sql`; migration chưa được xác nhận đã apply trên production.
- Local đã kiểm tra build, TypeScript, lint, diff và các route card/set/sitemap. Chưa coi đây là nghiệm thu production; còn deploy, submit sitemap, Rich Results Test và theo dõi coverage trong GSC/Bing.
- Sau review Phase 3: preview catalog trên `/pokemon` và `/onepiece` dùng cache 24 giờ theo category, lỗi query được xử lý riêng nên phần marketplace vẫn render. Query listing chỉ lấy sale đang public, sắp `price` tăng dần trước khi giới hạn 10 dòng để Offer dùng đúng giá thấp nhất. Build/TypeScript/lint/diff đạt; local production server trả 200 cho hai trang và vẫn có link catalog trong HTML. TTFB local: Pokémon lần đầu khoảng 0,18 giây, lượt có cache khoảng 0,02 giây; chưa đo Netlify.
- Sau vòng review kế tiếp: trang card render theo request để đọc Offer đang bán mới; thông tin catalog vẫn cache 1 ngày. Trang set `?page=` cũng render theo request nhưng group/danh sách thẻ/điều kiện pilot cache 1 ngày. Sitemap trả lỗi khi một trong hai query Supabase lỗi thay vì xuất thành công chỉ các route tĩnh. FAQPage JSON-LD được render cùng FAQ đang hiển thị và cập nhật theo locale. Build, TypeScript, lint, diff đạt; HTTP local `/help`, card, set trang 2, sitemap đều 200. Chromium headless xác nhận câu hỏi đầu và JSON-LD khớp ở cả VI/EN/JA (15 câu mỗi locale). Chưa kiểm chứng hành vi cache hay hiệu năng trên Netlify.

## Câu hỏi cho reviewer
1. Currency mặc định `USD` dành cho catalog; listing marketplace hiển thị VND trực tiếp và Product JSON-LD cũng khai VND. Việc đổi mặc định toàn site là quyết định UX riêng.
