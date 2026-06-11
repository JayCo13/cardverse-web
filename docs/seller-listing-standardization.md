# Spec: Chuẩn hoá Form Đăng Bán → Giá thị trường Việt Nam

> Mục tiêu: chuẩn hoá dữ liệu listing của seller để (1) mỗi listing gắn được vào ĐÚNG 1 lá thẻ trong catalog, và (2) tổng hợp được **giá thị trường VN thật** theo từng lá thẻ + tình trạng, để feature **scan → price** hiển thị giá VN bên cạnh giá eBay.

Người viết: (AI proposal) — Người thực hiện: teammate
Phạm vi: web `card-verse` (Next.js + Supabase).

---

## 1. Bối cảnh & vấn đề

Form đăng bán hiện tại: `src/app/sell/create/page.tsx` (zod schema `getFormSchema`). Bảng lưu: `cards` (xem `src/lib/supabase/database.types.ts`).

Form đang lưu: `name, category, publisher, set_name, season, condition, is_psa_graded/psa_grade (gộp vào condition), listing_type, price, quantity, images...`

**Thiếu để làm giá VN** (đây là gốc vấn đề):
- ❌ **Số thẻ** (collector number) — khóa định danh chính của 1 lá thẻ.
- ❌ **Ngôn ngữ** (EN/JP) — cùng artwork nhưng khác số & khác giá.
- ❌ **Link tới catalog** (`tcgcsv_products.product_id`) — để listing & scan dùng chung 1 khóa.
- ❌ **Hãng grade tách bạch** (PSA/BGS/CGC…) + điểm — hiện grade bị nhét vào chuỗi `condition`.
- ❌ **Biến thể/finish** (Holo/Reverse/1st Ed/Parallel) — ảnh hưởng lớn tới giá.

→ Nếu không có các trường trên, không thể gom listing theo từng lá thẻ → không có giá VN tin cậy.

**Nguyên tắc thiết kế:** listing của seller và kết quả scan phải **chia sẻ cùng khóa định danh** = `tcgcsv_products.product_id` (hoặc bộ `category_id + number + language` chuẩn hoá). Cách tốt nhất để đạt: cho seller **quét/chọn đúng lá thẻ từ catalog** khi đăng bán → auto-fill danh tính chuẩn.

---

## 2. Thay đổi Data Model

### 2.1. Bổ sung cột cho bảng `cards`

```sql
alter table cards
  add column if not exists catalog_product_id integer,           -- FK mềm tới tcgcsv_products.product_id
  add column if not exists card_number       text,               -- "199/197", "OP15-118", "TG12/TG30"
  add column if not exists language          text,               -- 'en' | 'jp' | null (cho soccer/khác)
  add column if not exists grading_company   text default 'raw', -- 'raw'|'psa'|'bgs'|'cgc'|'sgc'
  add column if not exists grade             numeric,            -- 1..10, null nếu raw
  add column if not exists finish            text;               -- 'normal'|'holo'|'reverse'|'1st'|'parallel'

create index if not exists idx_cards_catalog on cards (catalog_product_id);
```

> `catalog_product_id` để soft-link (không hard FK, vì catalog là bảng crawl ngoài). Cập nhật `database.types.ts` tương ứng (cards Row/Insert/Update).

### 2.2. Bảng ghi nhận giao dịch bán thành công (nguồn của giá VN)

```sql
create table if not exists vn_card_sales (
  id                 uuid primary key default gen_random_uuid(),
  catalog_product_id integer not null,          -- lá thẻ chuẩn
  card_id            uuid,                       -- listing nguồn (cards.id), tham chiếu
  category_id        integer,                    -- 3 EN / 85 JP / 68 OP / 99 soccer
  card_number        text,
  language           text,
  grading_company    text not null default 'raw',
  grade              numeric,
  finish             text,
  price              numeric not null,           -- giá BÁN thực (VND)
  sold_at            timestamptz not null default now()
);
create index if not exists idx_vn_sales_lookup
  on vn_card_sales (catalog_product_id, grading_company, grade, finish, sold_at desc);
```

### 2.3. View tổng hợp giá thị trường VN

```sql
create or replace view vn_market_price as
select
  catalog_product_id,
  grading_company,
  grade,
  finish,
  count(*)                                   as sale_count,
  percentile_cont(0.5) within group (order by price) as median_price,
  min(price)                                 as min_price,
  max(price)                                 as max_price,
  max(sold_at)                               as last_sold_at
from vn_card_sales
where sold_at > now() - interval '90 days'
group by catalog_product_id, grading_company, grade, finish;
```

> Có thể thêm view 30 ngày nếu muốn “giá gần đây”. Median chống outlier tốt hơn average.

---

## 3. Thay đổi Form Đăng Bán (`sell/create`)

Chia làm 4 phần. **Phần 1 là trọng tâm mới.**

### Phần 1 — Xác định thẻ (MỚI)
- Nút **“🔍 Quét / Chọn thẻ từ catalog”**:
  - Mở 1 picker: ô search theo tên/số → query `tcgcsv_products` (đã có sẵn endpoint pattern trong scan, dùng service-role route `/api/scan/pokemon-match` cho tìm theo số, hoặc tạo `/api/catalog/search`).
  - (Tuỳ chọn) tái dùng luồng **scan ảnh** của `market-spotlight.tsx` để seller chụp thẻ → chọn từ kết quả.
  - Khi seller chọn 1 lá → set: `catalog_product_id, category, language (theo category_id: 3→en, 85→jp), set_name, card_number, name` và **khóa các field này** (cho sửa nếu cần).
- Fallback nhập tay nếu không tìm thấy trong catalog (vẫn nhập `card_number`, `language`).

### Phần 2 — Tình trạng & biến thể (MỚI/tách bạch)
- `grading_company`: select `Raw | PSA | BGS | CGC | SGC`.
- Nếu graded → `grade`: select `1..10` (cho 0.5 step nếu BGS).
- Nếu Raw → `condition`: `NM | LP | MP | HP` (giữ field cũ).
- `finish`: select `Normal | Holo | Reverse Holo | 1st Edition | Parallel`.

### Phần 3 — Hình thức bán (GIỮ NGUYÊN)
`listing_type (sale/auction/razz)`, `price/starting_bid/auction_ends/ticket_price/total_tickets`, `accept_offers/min_offer_percent`, `quantity`.

### Phần 4 — Ảnh & mô tả (GIỮ NGUYÊN)
1–4 ảnh, `description`.

### Cập nhật zod schema (`getFormSchema`)
Thêm:
```ts
catalogProductId: z.number().optional(),
cardNumber: z.string().optional(),     // bắt buộc nếu KHÔNG phải bundle và category là pokemon/onepiece/soccer
language: z.enum(['en','jp']).optional(),
gradingCompany: z.enum(['raw','psa','bgs','cgc','sgc']).default('raw'),
grade: z.number().min(1).max(10).optional(),
finish: z.enum(['normal','holo','reverse','1st','parallel']).default('normal'),
```
Rule: nếu `gradingCompany !== 'raw'` → `grade` bắt buộc. Nếu thẻ đơn (không bundle) thuộc pokemon/onepiece → `cardNumber` + `language` bắt buộc.

### Lưu khi submit
Map các field mới vào `cards` insert (`catalog_product_id, card_number, language, grading_company, grade, finish`). Giữ tương thích ngược: `condition` vẫn set (vd `"PSA 10"` hoặc `"NM"`) cho UI cũ.

---

## 4. Write path — ghi giao dịch giá VN

Khi 1 đơn **bán thành công** (status chuyển sang `completed`/`delivered`):
- Hook tại: `src/app/api/marketplace/orders/route.ts` (lúc cập nhật trạng thái hoàn tất) **hoặc** `src/app/api/shipping/webhook/route.ts` (khi GHN báo `delivered`).
- Insert vào `vn_card_sales` từ `cards` của listing:
```ts
await service.from('vn_card_sales').insert({
  catalog_product_id: card.catalog_product_id,
  card_id: card.id,
  category_id: ...,            // map từ category + language
  card_number: card.card_number,
  language: card.language,
  grading_company: card.grading_company,
  grade: card.grade,
  finish: card.finish,
  price: order.amount,         // giá bán thực
});
```
- Chỉ ghi khi `catalog_product_id` not null (listing đã chuẩn hoá). Listing cũ/không chuẩn → bỏ qua.

---

## 5. Read path — Scan hiển thị giá VN

Trong `src/components/market-spotlight.tsx`, sau khi scan match ra `product` (đã có `product_id`):
- Query `vn_market_price` theo `catalog_product_id = product_id` (+ lọc theo grade/finish nếu UI cho chọn).
- Hiển thị cạnh giá eBay: **“Giá thị trường VN: {median_price} · {sale_count} giao dịch · cập nhật {last_sold_at}”**.
- Nếu `sale_count = 0` → ẩn hoặc ghi “Chưa có dữ liệu giá VN”.

---

## 6. Edge cases & lưu ý
- **Bundle** (`is_bundle`): không gắn 1 `catalog_product_id` → không ghi `vn_card_sales`. Bỏ qua chuẩn hoá số thẻ.
- **Category “Khác”/Soccer**: `language` có thể null; `catalog_product_id` có thể null nếu không có trong catalog → vẫn cho đăng, chỉ không vào giá VN.
- **Soccer**: catalog soccer riêng (view `featured_soccer_cards`) — nếu muốn giá VN cho soccer, link tới id soccer tương ứng.
- **Grade chuẩn hoá**: lưu `grading_company` + `grade` riêng, KHÔNG nhét vào `condition` (để group giá chính xác PSA10 vs PSA9 vs Raw).
- **Chống nhiễu giá**: chỉ tính `vn_card_sales` từ đơn HOÀN TẤT (đã giao), không tính listing đang treo (tránh seller hét giá làm lệch).
- **Backfill (tuỳ chọn)**: với listing cũ đã bán, nếu có đủ thông tin có thể backfill `vn_card_sales` 1 lần.

---

## 7. Checklist công việc
- [ ] Migration: thêm cột `cards` + bảng `vn_card_sales` + view `vn_market_price` (mục 2). Cập nhật `database.types.ts`.
- [ ] Form `sell/create`: Phần 1 (catalog picker + auto-fill + khóa field) — quan trọng nhất.
- [ ] Form: Phần 2 (grading_company/grade/finish tách bạch).
- [ ] Zod schema + validation rules (số thẻ/ngôn ngữ bắt buộc cho thẻ đơn; grade bắt buộc khi graded).
- [ ] Submit: map field mới vào `cards`.
- [ ] Write path: ghi `vn_card_sales` khi đơn hoàn tất (orders route / shipping webhook).
- [ ] Read path: scan join `vn_market_price` → hiển thị giá VN trong `market-spotlight`.
- [ ] (Tuỳ chọn) endpoint `/api/catalog/search` cho picker.

## 8. Tiêu chí nghiệm thu
1. Đăng bán 1 thẻ Pokémon: chọn từ catalog → `cards` lưu đủ `catalog_product_id, card_number, language, grading_company, grade, finish`.
2. Hoàn tất 1 đơn → có 1 dòng trong `vn_card_sales` với đúng `catalog_product_id` + `price`.
3. Scan lại đúng lá thẻ đó → hiển thị “Giá thị trường VN: …” khớp với median của `vn_market_price`.
4. Thẻ chưa có giao dịch VN → không hiện giá VN (không lỗi).

---

## 9. YÊU CẦU: Nâng cấp Bộ lọc (Filters) trang mua (`/buy`)

Bộ lọc hiện tại chỉ có: tìm theo tên + danh mục + tình trạng → quá thô và một số giá trị **không khớp** dữ liệu chuẩn hoá. Cập nhật như sau.

### 9.1. Tìm kiếm (nâng cấp)
- Ô search phải tìm theo **tên VÀ số thẻ**: gõ `Charizard`, `199/197`, `OP15-118`, `TG12/TG30` đều ra.
- Query: `name ilike %q% OR card_number ilike %q%`.

### 9.2. Danh mục (sửa cho khớp catalog thật)
- Giá trị ĐÚNG: **Pokémon · One Piece · Bóng đá (Soccer) · Khác**.
- ⚠️ Hiện đang có **“Ma thuật” (Magic)** và **THIẾU “One Piece”** → sai. Sửa lại đúng 4 danh mục trên (theo `category` thực trong `cards`).

### 9.3. Ngôn ngữ (MỚI — chỉ hiện cho Pokémon / One Piece)
- Giá trị: **Tiếng Anh (en) · Tiếng Nhật (jp)**.
- Cột: `cards.language`. Ẩn filter này khi danh mục là Soccer/Khác.

### 9.4. Bộ / Set (MỚI — phụ thuộc danh mục)
- Dropdown chọn **Set** (vd “Surging Sparks”, “OP15”). Nguồn: `cards.set_name` (distinct theo category đang lọc), hoặc dùng catalog sets như form đăng bán.
- Chỉ hiện khi đã chọn danh mục có set (Pokémon/OP).

### 9.5. Phân loại Grade (MỚI)
- Giá trị: **Raw · PSA · BGS · CGC · SGC**. Cột: `cards.grading_company`.

### 9.6. Điểm grade (MỚI — phụ thuộc 9.5)
- Khi chọn 1 hãng graded (PSA/BGS/CGC/SGC) → hiện filter **điểm**: 10 / 9.5 / 9 / 8 / … (hoặc khoảng ≥9, ≥8). Cột: `cards.grade`.

### 9.7. Tình trạng (sửa — chỉ áp dụng cho Raw)
- **Chỉ hiện khi Grade = Raw** (thẻ graded dùng điểm, không dùng tình trạng).
- ⚠️ **Chuẩn hoá giá trị KHỚP với form đăng bán** (single source of truth). Chốt 1 bộ — đề xuất chuẩn TCG:
  **Near Mint (NM) · Lightly Played (LP) · Moderately Played (MP) · Heavily Played (HP) · Damaged (DMG)**.
  Bộ 5 mức tiếng Việt hiện tại (Hoàn hảo/Gần như mới/Tuyệt vời/Tốt/Đã qua sử dụng) phải map về đúng các giá trị **lưu trong DB** — filter value PHẢI bằng giá trị `cards.condition` đang lưu, nếu không lọc ra rỗng.

### 9.8. Biến thể / Finish (MỚI)
- Giá trị: **Thường · Holo · Reverse Holo · 1st Edition · Parallel**. Cột: `cards.finish`.

### 9.9. Hình thức bán (MỚI, tuỳ chọn)
- **Bán thẳng · Đấu giá · Razz**. Cột: `cards.listing_type`.

### 9.10. Khoảng giá (MỚI, tuỳ chọn)
- Min/max VND. Cột: `cards.price` (hoặc `current_bid` cho đấu giá).

### 9.11. Sắp xếp (MỚI, tuỳ chọn)
- Mới nhất · Giá tăng dần · Giá giảm dần.

### Quy tắc phụ thuộc (quan trọng)
1. **Grade vs Tình trạng loại trừ nhau**: Raw → hiện *Tình trạng* (9.7); graded → hiện *Điểm* (9.6).
2. **Ngôn ngữ & Set** chỉ hiện khi danh mục là Pokémon/One Piece.
3. **Mọi filter value phải == giá trị lưu trong DB** (đặc biệt `condition`, `finish`, `grading_company`) — tránh lọc ra rỗng. Lý tưởng: dùng chung enum với form đăng bán (mục 3).
4. Filter rỗng/không chọn = không áp điều kiện đó.

### Acceptance
- Lọc `Pokémon + JP + Set "..." + PSA + 10` → ra đúng các thẻ Pokémon Nhật PSA 10 thuộc set đó.
- Lọc `Raw + NM` → ra thẻ raw NM; không lẫn thẻ graded.
- Search `199/197` → ra mọi listing có số thẻ đó.
- Đổi danh mục sang Soccer → ẩn filter Ngôn ngữ & Set.
