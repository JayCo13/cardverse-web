# Bộ tài liệu pháp lý CardVerseHub

Ba tài liệu bắt buộc của một sàn thương mại điện tử, xuất từ đúng nội dung đang hiển thị trên website. Cập nhật lần cuối: 6 tháng 9, 2026.

## Nội dung bộ tài liệu

Tiếng Việt, bản gốc:

* [Điều khoản dịch vụ](vi/dieu-khoan-dich-vu.md): 15 mục, công bố tại `/terms`
* [Chính sách bảo mật](vi/chinh-sach-bao-mat.md): 13 mục, công bố tại `/privacy`
* [Cơ chế khiếu nại](vi/co-che-khieu-nai.md): 12 mục, công bố tại `/complaints`

Bản dịch tham khảo:

* [English](en/): `terms-of-service.md`, `privacy-policy.md`, `complaint-mechanism.md`
* [日本語](ja/): `terms-of-service.md`, `privacy-policy.md`, `complaint-mechanism.md`

Bản tiếng Việt là bản có hiệu lực. Hai bản còn lại phục vụ người dùng quốc tế và nội bộ; khi có khác biệt về cách hiểu, bản tiếng Việt được áp dụng.

## Nguồn sự thật và cách cập nhật

Toàn bộ câu chữ nằm trong `src/lib/i18n/{vi,en,ja}.ts`, dưới các khoá `terms_section_*`, `privacy_section_*`, `complaints_section_*`. Đó là thứ người dùng thực sự đọc, nên đó là bản gốc. Các file markdown trong thư mục này được sinh ra từ đó.

Quy trình sửa nội dung:

1. Sửa cả ba từ điển `vi.ts`, `en.ts`, `ja.ts`. `TranslationKey` lấy khoá từ `en.ts` nên thiếu một khoá ở `vi.ts` hoặc `ja.ts` sẽ làm `npx tsc --noEmit` báo lỗi.
2. Nếu thêm hoặc bớt mục, sửa số lượng mục trong `src/lib/legal.ts` và trong `DOCS` của `scripts/export-legal-docs.mjs`.
3. Đổi `LEGAL_LAST_UPDATED` trong `src/lib/legal.ts` sang ngày sửa thật.
4. Chạy `npm run docs:legal` để sinh lại markdown.

Đừng sửa trực tiếp các file `.md` ở đây. Lần chạy tiếp theo sẽ ghi đè, và một tài liệu pháp lý không khớp với trang mà nó tự nhận là bản sao thì tệ hơn là không có tài liệu.

Trình sinh cũng kiểm tra một quy tắc của bộ nội dung này: không dùng dấu gạch nối trong câu chữ. Nếu có ký tự gạch nối lọt vào từ điển, `npm run docs:legal` dừng lại và báo tên khoá vi phạm.

## Đối chiếu điều khoản với hệ thống

Mỗi con số trong tài liệu đều lấy từ code. Khi sửa một trong các chỗ dưới đây, phải sửa tài liệu tương ứng.

Điều khoản dịch vụ:

* Mục 3, xác minh danh tính người bán → `src/app/api/seller/kyc/*`, `src/app/api/seller/verify`, chi tiết trong `docs/kyc-didit.md`
* Mục 5, cửa sổ thanh toán 24 giờ cho đề nghị giá → `supabase/migrations/20260902000100_offer_payment_window.sql`
* Mục 6, tạm giữ tiền và cửa sổ 72 giờ → `supabase/migrations/20260905000500_auto_release_on_confirmed_delivery.sql`, hàm `complete_delivered_orders()`, tổng quan trong `docs/money-flow.md`
* Mục 7, hạn giao hàng 24 giờ và danh sách đơn vị vận chuyển → `orders.ship_deadline`, `src/lib/expire-orders.ts`, `src/lib/shipping-carriers.ts`
* Mục 8, video đóng gói và video mở hộp → `supabase/migrations/20260905000100_dispute_evidence_videos.sql`
* Mục 9, phí 8% và mức rút tối thiểu 50.000 đồng → `supabase/migrations/20260902000200_withdrawal_fee_8_percent.sql`, hằng `MIN_WITHDRAW` trong `src/app/api/wallet/withdraw/route.ts`
* Mục 10, giá và hạn dùng các gói quét → `PACKAGES` trong `src/lib/payos.ts`
* Mục 11, huỷ đơn và hoàn tiền → `src/app/api/marketplace/orders/route.ts`

Cơ chế khiếu nại:

* Mục 3, thời hạn khiếu nại → cột `orders.auto_complete_at`
* Mục 4, nút Báo admin → action `dispute` trong `src/app/api/marketplace/orders/route.ts`
* Mục 7, thứ tự phân định → phần chú thích đầu file `supabase/migrations/20260905000100_dispute_evidence_videos.sql`. Tài liệu chép đúng thứ tự đó: xét việc giao hàng trước, sau đó mới xét video, và kết quả tự động chỉ là khuyến nghị
* Mục 8, thực hiện kết quả → `refund_buyer` và `release_seller` trong app quản trị `cardverse-ad`
* Mục 9, hoàn tiền khi lệnh rút bị từ chối → RPC `refund_withdrawal()`

Chính sách bảo mật:

* Mục 2, các nhóm dữ liệu → bảng `profiles`, `kyc_sessions`, `bank_account_lookups`, `wallet_transactions`, `device_scan_usage`
* Mục 5, danh sách bên thứ ba → phần Architecture trong `CLAUDE.md` và các client trong `src/lib/`

## Những điểm cần biết trước khi công bố

* Các mốc thời gian xử lý khiếu nại trong mục 6 của Cơ chế khiếu nại, gồm tiếp nhận trong 24 giờ, phản hồi trong 48 giờ, kết luận trong 7 ngày làm việc, tối đa 30 ngày, là cam kết vận hành. Không có gì trong hệ thống bắt buộc các mốc này, nên đội vận hành phải xác nhận đáp ứng được trước khi công bố.
* Tuổi tối thiểu 18 để giao dịch và 16 đối với dữ liệu cá nhân là lựa chọn chính sách, hệ thống hiện không kiểm tra tuổi.
* Đơn gửi qua Viettel Post không có tín hiệu theo dõi tự động. Tài liệu đã nêu đúng là trạng thái ghi nhận chưa xác thực và do người xử lý quyết định, không hứa hẹn tự động hoá.
* `release_seller` trong app quản trị trả `amount` trừ `platform_fee`. Với đơn mới `platform_fee` bằng 0 nên đúng như tài liệu mô tả, nhưng các đơn cũ còn giá trị khác 0 sẽ bị trả thiếu. Xem phần Known gaps trong `docs/money-flow.md`.
* Footer website còn thiếu tên pháp nhân, địa chỉ đăng ký, mã số thuế và badge thông báo Bộ Công Thương. Ba tài liệu này không thay thế được nghĩa vụ đó.
