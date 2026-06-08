// =====================================================================
// Shopee Affiliate config
//
// CardVerse is a trading-card site, so the natural affiliate fit is card
// CARE/STORAGE accessories (sleeves, toploaders, binders, deck boxes…).
//
// HOW TO EARN COMMISSION:
//   The `url`s below are plain Shopee search links so the UI works right
//   away. To actually earn, replace each `url` with YOUR tracked Shopee
//   Affiliate short-link (e.g. https://s.shopee.vn/xxxxxxxxx) generated in
//   the Shopee Affiliate dashboard / link converter. Keep `enabled = true`.
// =====================================================================

export const SHOPEE_AFFILIATE_ENABLED = true;

export type ShopeeIcon = 'sleeve' | 'toploader' | 'binder' | 'deckbox' | 'case' | 'tool';

export interface ShopeeProduct {
    id: string;
    name: string;        // short product/category label (VN)
    desc: string;        // one-line benefit
    icon: ShopeeIcon;
    url: string;         // <-- replace with your tracked affiliate short-link
    priceText?: string;  // optional "từ 15k" style hint
}

export const SHOPEE_ACCESSORIES: ShopeeProduct[] = [
    {
        id: 'sleeves',
        name: 'Bọc bài (Sleeves)',
        desc: 'Chống xước, bảo vệ mặt thẻ',
        icon: 'sleeve',
        priceText: 'từ 15k',
        url: 'https://shopee.vn/search?keyword=sleeve%20b%E1%BB%8Dc%20th%E1%BA%BB%20b%C3%A0i',
    },
    {
        id: 'toploader',
        name: 'Toploader / Khung cứng',
        desc: 'Giữ thẻ phẳng, không cong gập',
        icon: 'toploader',
        priceText: 'từ 20k',
        url: 'https://shopee.vn/search?keyword=toploader%20th%E1%BA%BB%20b%C3%A0i',
    },
    {
        id: 'magnetic',
        name: 'Ốp từ (Magnetic)',
        desc: 'Trưng bày thẻ giá trị cao',
        icon: 'case',
        priceText: 'từ 35k',
        url: 'https://shopee.vn/search?keyword=magnetic%20holder%20th%E1%BA%BB%20b%C3%A0i',
    },
    {
        id: 'binder',
        name: 'Binder / Album',
        desc: 'Lưu trữ & sắp xếp bộ sưu tập',
        icon: 'binder',
        priceText: 'từ 90k',
        url: 'https://shopee.vn/search?keyword=binder%20album%20th%E1%BA%BB%20b%C3%A0i',
    },
    {
        id: 'deckbox',
        name: 'Hộp đựng bài (Deck box)',
        desc: 'Cất giữ & mang theo an toàn',
        icon: 'deckbox',
        priceText: 'từ 25k',
        url: 'https://shopee.vn/search?keyword=deck%20box%20h%E1%BB%99p%20%C4%91%E1%BB%B1ng%20th%E1%BA%BB',
    },
    {
        id: 'tool',
        name: 'Phụ kiện vệ sinh',
        desc: 'Lau thẻ, dụng cụ bảo quản',
        icon: 'tool',
        priceText: 'từ 30k',
        url: 'https://shopee.vn/search?keyword=ph%E1%BB%A5%20ki%E1%BB%87n%20b%E1%BA%A3o%20qu%E1%BA%A3n%20th%E1%BA%BB%20b%C3%A0i',
    },
];
