import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '@/lib/listing-description';

const MIN_PRICE_VND = (1000).toLocaleString('vi-VN');

/**
 * What a seller reads when the database turns their listing away.
 *
 * `create_marketplace_listing` signals by raising, so its exception text is a
 * bare code — `invalid_listing_payload` — and that string used to be handed
 * straight to the browser. A seller filling in the form got "Error:
 * invalid_listing_payload" and no idea which field to fix.
 *
 * The API route mirrors most of these checks and answers them earlier with a
 * real sentence, so anything that reaches here slipped past that mirror. The
 * code alone does not say which field failed, so the message has to name every
 * field the database looks at. Written from the database's conditions rather
 * than the route's: where the two disagree, the database is what rejected it.
 *
 * Lives outside the route because a route module may only export handlers.
 */
export const LISTING_ERROR_MESSAGES: Record<string, string> = {
    unauthorized: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.',
    seller_verification_required:
        'Bạn cần xác minh danh tính người bán trước khi đăng bán.',
    missing_seller_address:
        'Bạn cần thêm địa chỉ lấy hàng (quận/huyện và phường/xã) trong hồ sơ trước khi đăng bán.',
    missing_shipping_config:
        'Bạn cần thiết lập đơn vị vận chuyển và phí ship cho shop trước khi đăng bán.',
    invalid_listing_request: 'Yêu cầu đăng bán không hợp lệ. Tải lại trang rồi thử lại.',
    idempotency_conflict:
        'Tin đăng này đã được gửi trước đó với nội dung khác. Tải lại trang để kiểm tra trước khi đăng lại.',
    invalid_listing_payload:
        'Thông tin tin đăng chưa hợp lệ. Kiểm tra lại: danh mục, tiêu đề (5-200 ký tự), '
        + `mô tả (${DESCRIPTION_MIN}-${DESCRIPTION_MAX} ký tự), ảnh (1-4 ảnh) và số lượng (1-100).`,
    invalid_listing_price: `Giá bán phải là một số và tối thiểu ${MIN_PRICE_VND}đ.`,
    invalid_listing_auction:
        `Giá khởi điểm phải là một số, tối thiểu ${MIN_PRICE_VND}đ, và thời gian kết thúc phải ở tương lai.`,
    invalid_listing_razz:
        `Giá vé phải là một số và tối thiểu ${MIN_PRICE_VND}đ, số vé từ 2 đến 1000.`,
};

/** Shown when the database fails in a way this file has not been taught yet. */
export const LISTING_ERROR_FALLBACK = 'Không thể đăng bán lúc này. Vui lòng thử lại.';

/**
 * Reads the code out of a raised Postgres message and pairs it with its
 * sentence. `code` stays null for anything unrecognised, which the caller logs
 * — a missing entry here should be debuggable from the server, never from the
 * seller's screen.
 *
 * Longest code first: `invalid_listing_request` contains no other code, but
 * matching by substring is only safe while no code is a prefix of another, and
 * ordering by length keeps it safe if one ever is.
 */
export function resolveListingError(raw: string | null | undefined): {
    code: string | null;
    message: string;
} {
    const codes = Object.keys(LISTING_ERROR_MESSAGES).sort((a, b) => b.length - a.length);
    const code = raw ? codes.find((value) => raw.includes(value)) ?? null : null;
    return { code, message: code ? LISTING_ERROR_MESSAGES[code] : LISTING_ERROR_FALLBACK };
}
