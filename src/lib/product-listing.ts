export const PRODUCT_KINDS = ['card', 'box', 'pack', 'deck', 'accessory', 'other'] as const;
export type ProductKind = typeof PRODUCT_KINDS[number];
export const PRODUCT_CONDITIONS = ['sealed', 'new', 'opened', 'used'] as const;
export const PRODUCT_DETAIL_KEYS = ['brand', 'edition', 'language', 'product_code'] as const;
export type ProductDetails = Partial<Record<typeof PRODUCT_DETAIL_KEYS[number], string>>;
export const flexibleProductsEnabled = process.env.NEXT_PUBLIC_FLEXIBLE_PRODUCTS_ENABLED === 'true';
export const isProductKind = (value: unknown): value is ProductKind => PRODUCT_KINDS.includes(value as ProductKind);
export const isNonCard = (kind?: string | null) => !!kind && kind !== 'card';

const COPY = {
  'en-US': {
    title: 'List a product', choose: 'What are you selling?', card: 'Trading card', box: 'Box', pack: 'Pack', deck: 'Deck / product set', accessory: 'Accessory', other: 'Other', all: 'All products',
    sealed: 'Factory sealed', new: 'New / unused', opened: 'Opened', used: 'Used', condition: 'Item condition',
    details: 'Additional details (optional)', brand: 'Brand', edition: 'Set / edition', language: 'Language', product_code: 'Product code / UPC', type: 'Product type',
    whole: 'The price is for the entire item or lot shown. This listing sells once; describe everything included.',
    images: 'Show the whole product, its packaging, seals and any imperfections. The first photo is the cover.',
    shipping: 'Set the fee for this entire item or lot. Check the packed weight and dimensions when booking shipping.',
    shippingFromTable: 'Leave empty to use your shop fee table',
    invalid: 'Check the product type, condition and details.', confirm: 'Changing product group clears card-specific details and condition. Keep title, photos, description and price?',
    locked: 'Product group and category cannot change after listing. Create a new listing for a different item.',
    keepSwitch: 'Switch group', cancelSwitch: 'Stay here',
    listNew: 'List a new product', firstListing: 'List your first product',
    chooseHint: 'This sets which fields the form asks for.',
  },
  'vi-VN': {
    title: 'Đăng bán sản phẩm', choose: 'Bạn muốn bán gì?', card: 'Thẻ bài', box: 'Box / Hộp', pack: 'Pack / Gói thẻ', deck: 'Deck / Bộ sản phẩm', accessory: 'Phụ kiện', other: 'Khác', all: 'Tất cả sản phẩm',
    sealed: 'Nguyên seal', new: 'Mới chưa sử dụng', opened: 'Đã mở', used: 'Đã sử dụng', condition: 'Tình trạng sản phẩm',
    details: 'Thông tin thêm (không bắt buộc)', brand: 'Thương hiệu', edition: 'Set / phiên bản', language: 'Ngôn ngữ', product_code: 'Mã sản phẩm / UPC', type: 'Loại sản phẩm',
    whole: 'Giá cho toàn bộ món hoặc lô trong bài đăng. Bài đăng bán một lần; hãy mô tả rõ mọi thứ người mua nhận được.',
    images: 'Chụp toàn bộ sản phẩm, bao bì, seal và các khuyết điểm. Ảnh đầu tiên là ảnh bìa.',
    shipping: 'Đặt phí cho cả món hoặc lô. Kiểm tra cân nặng và kích thước kiện đã đóng gói khi tạo vận đơn.',
    shippingFromTable: 'Để trống để dùng bảng phí của shop',
    invalid: 'Vui lòng kiểm tra loại sản phẩm, tình trạng và thông tin chi tiết.', confirm: 'Đổi nhóm sẽ xóa thông tin riêng của thẻ và tình trạng. Giữ tiêu đề, ảnh, mô tả và giá?',
    locked: 'Nhóm sản phẩm và chủ đề được giữ nguyên sau khi đăng. Tạo bài mới nếu bán món khác.',
    keepSwitch: 'Đổi nhóm', cancelSwitch: 'Giữ nguyên',
    listNew: 'Đăng sản phẩm mới', firstListing: 'Đăng bán sản phẩm đầu tiên',
    chooseHint: 'Lựa chọn này quyết định các trường form sẽ hỏi.',
  },
  'ja-JP': {
    title: '商品を出品', choose: '何を出品しますか？', card: 'カード', box: 'ボックス', pack: 'パック', deck: 'デッキ / セット', accessory: 'アクセサリー', other: 'その他', all: 'すべての商品',
    sealed: '未開封', new: '新品 / 未使用', opened: '開封済み', used: '中古', condition: '商品の状態',
    details: '追加情報（任意）', brand: 'ブランド', edition: 'セット / エディション', language: '言語', product_code: '商品コード / UPC', type: '商品タイプ',
    whole: '価格は出品した商品・セット全体の金額です。一度の販売で全体を購入します。内容を明記してください。',
    images: '商品全体、包装、封印、傷を撮影してください。最初の写真が表紙です。',
    shipping: '商品全体の送料を設定してください。発送時に梱包後の重量と寸法を確認します。',
    shippingFromTable: '空欄ならショップの送料表を使用します',
    invalid: '商品タイプ、状態、詳細を確認してください。', confirm: '変更するとカード固有の情報と状態が消去されます。タイトル、写真、説明、価格は保持します。続けますか？',
    locked: '出品後は商品グループとカテゴリを変更できません。別の商品は新しく出品してください。',
    keepSwitch: 'グループを変更', cancelSwitch: 'そのままにする',
    listNew: '新しい商品を出品', firstListing: '最初の商品を出品',
    chooseHint: 'この選択によって入力項目が変わります。',
  },
};
export const productCopy = (locale: string) => COPY[locale as keyof typeof COPY] || COPY['en-US'];
export const productConditionLabel = (condition: string | null | undefined, locale: string) =>
  PRODUCT_CONDITIONS.includes(condition as typeof PRODUCT_CONDITIONS[number])
    ? productCopy(locale)[condition as typeof PRODUCT_CONDITIONS[number]] : condition || '';

/** Shared API/form validation; database independently enforces the same boundary. */
export function validProductDetails(value: unknown): value is ProductDetails {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, val]) => PRODUCT_DETAIL_KEYS.includes(key as typeof PRODUCT_DETAIL_KEYS[number])
      && typeof val === 'string' && val.length <= 100);
}
