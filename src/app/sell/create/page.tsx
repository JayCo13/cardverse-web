
'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocalization } from '@/context/localization-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, ShieldAlert, X, Loader2, Info, HandCoins, Plus, Trash2, Layers, MapPin } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSupabase, useUser } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { USD_TO_VND_RATE } from '@/contexts/currency-context';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { getCloudinarySignature, uploadImageDirectToCloudinary } from '@/lib/cloudinary-direct';
import { isHeicFile, convertHeicToJpeg } from '@/lib/heic';
import { compressImage } from '@/lib/image-compress';
import dynamic from 'next/dynamic';
import {
  getCategories,
  getCategoryConfig,
  getPublishers,
  getStaticSets,
  getSeasons,
  isSinglePublisher,
  isFreeText,
  isDbSets,
  fetchDbSetsGrouped,
  type SetConfig,
  type GroupedSets,
} from '@/lib/card-catalog';
import { type SelectedCatalogCard } from '@/components/card-picker-dialog';
import { CatalogCardPicker, catalogTabToCategory, type CatalogPick, type CatalogTabId } from '@/components/catalog-card-picker';
import { VnMarketPrice } from '@/components/vn-market-price';
import { SearchableSetPicker } from '@/components/searchable-set-picker';
import { SellerAddressForm } from '@/components/seller-address-form';

// Lazy-loaded: the picker dialog (and its catalog deps) only mount when opened,
// so keep it out of the initial bundle to make the page load lighter.
const CardPickerDialog = dynamic(
  () => import('@/components/card-picker-dialog').then((m) => m.CardPickerDialog),
  { ssr: false }
);

type LocaleCopy = {
  fieldLabels: Record<string, string>;
  titleMin: string;
  chooseCategory: string;
  minSalePrice: string;
  minStartingBid: string;
  minTicketPrice: string;
  descriptionMin: string;
  minImages: string;
  maxImages: string;
  enterPrice: string;
  enterAuction: string;
  enterRazz: string;
  choosePublisher: string;
  enterPublisher: string;
  chooseGrade: string;
  chooseCondition: string;
  enterCardNumber: string;
  chooseLanguage: string;
  created: string;
  createdDesc: string;
  createErrorTitle: string;
  createErrorDesc: string;
  checkingSeller: string;
  checkingSellerDesc: string;
  kycNeeded: string;
  kycNeededDesc: string;
  addPickup: string;
  addPickupDesc: string;
  saveAndContinue: string;
  missingTitle: string;
  missingDesc: string;
  missingFallback: string;
  cardIdentityTitle: string;
  cardIdentityDesc: string;
  clearSelection: string;
  marketPrice: string;
  useThisPrice: string;
  suggestedApplied: string;
  cardNumber: string;
  cardNumberPlaceholder: string;
  cardLanguage: string;
  cardLanguagePlaceholder: string;
  cardLanguageEn: string;
  cardLanguageJp: string;
  bundleTitle: string;
  bundleDesc: string;
  listingTitle: string;
  listingTitlePlaceholder: string;
  listingTitleHint: string;
  detailsTitle: string;
  publisher: string;
  publisherPlaceholder: string;
  publisherInputPlaceholder: string;
  setLabel: string;
  setPlaceholder: string;
  season: string;
  seasonPlaceholder: string;
  seasonSelectPlaceholder: string;
  quantity: string;
  gradingTitle: string;
  gradingCompany: string;
  raw: string;
  finish: string;
  bundleList: string;
  cardsCount: string;
  addCard: string;
  cardItemPlaceholder: string;
  bundleDisplayPrice: string;
  bundleTotalValue: string;
  bundleAttrsTitle: string;
  bundleAttrsHint: string;
  attrCondition: string;
  attrSet: string;
  attrGrading: string;
  attrLanguage: string;
  poolSetPlaceholder: string;
  poolGradingPlaceholder: string;
  poolAddBtn: string;
  attrAssignPlaceholder: string;
  processingImages: string;
  imageUploadHint: string;
  imageReorderHint: string;
  coverImageBadge: string;
  priceUsdPlaceholder: string;
  priceBundlePlaceholder: string;
  priceVndPlaceholder: string;
  vndNote: string;
  usdNote: string;
  inputVndNote: string;
  acceptOffers: string;
  acceptOffersDesc: string;
  bundleOfferNote: string;
  minOffer: string;
  acceptAllOffers: string;
  nearOriginalPrice: string;
  payoutNote: string;
  payoutNoteDesc: string;
  usdConfirmTitle: string;
  usdConfirmDesc: string;
  editPrice: string;
  confirmPrice: string;
};

const getLocaleCopy = (locale: string): LocaleCopy => {
  if (locale === 'ja-JP') {
    return {
      fieldLabels: {
        name: 'タイトル', category: 'カテゴリ', condition: 'カード状態', publisher: '出版社', setName: 'セット',
        season: 'シーズン / 年', quantity: '数量', grade: 'グレード', gradingCompany: '鑑定会社',
        cardNumber: 'カード番号', language: 'カード言語', price: '販売価格', startingBid: '開始価格',
        auctionEnds: '終了日時', ticketPrice: 'チケット価格', totalTickets: 'チケット総数', description: '説明', images: '画像',
      },
      titleMin: 'タイトルは5文字以上必要です。',
      chooseCategory: 'カテゴリを選択してください。',
      minSalePrice: `最低販売価格は${MIN_MARKETPLACE_PRICE_VND.toLocaleString('ja-JP')} VNDです。`,
      minStartingBid: `最低開始価格は${MIN_MARKETPLACE_PRICE_VND.toLocaleString('ja-JP')} VNDです。`,
      minTicketPrice: `最低チケット価格は${MIN_MARKETPLACE_PRICE_VND.toLocaleString('ja-JP')} VNDです。`,
      descriptionMin: '説明は300文字以上必要です。',
      minImages: '画像を1枚以上アップロードしてください。',
      maxImages: '画像は最大4枚までです。',
      enterPrice: '販売価格を入力してください。',
      enterAuction: '開始価格と終了日時を入力してください。',
      enterRazz: 'チケット価格と総数を入力してください。',
      choosePublisher: '出版社を選択してください。',
      enterPublisher: '出版社を入力してください。',
      chooseGrade: 'グレードを選択してください。',
      chooseCondition: 'カード状態を選択してください。',
      enterCardNumber: 'カード番号を入力してください（例: 199/197, OP15-118）。',
      chooseLanguage: 'カード言語を選択してください（EN/JP）。',
      created: '出品が完了しました',
      createdDesc: 'カードがマーケットに掲載されました。',
      createErrorTitle: 'エラー',
      createErrorDesc: '出品の作成中に問題が発生しました。',
      checkingSeller: '販売者権限を確認中',
      checkingSellerDesc: 'しばらくお待ちください。',
      kycNeeded: 'KYCが未承認です',
      kycNeededDesc: '出品する前にSellerページで本人確認を完了してください。',
      addPickup: '集荷住所を追加',
      addPickupDesc: '出品前に集荷住所を設定してください。購入者向けの送料計算に必要です。',
      saveAndContinue: '住所を保存して続行',
      missingTitle: '入力不足があります',
      missingDesc: '確認してください: {fields}.',
      missingFallback: '未入力の項目を確認してください。',
      cardIdentityTitle: '正しいカードを特定',
      cardIdentityDesc: 'カタログからカードを選ぶと、VN市場価格との紐付けが正確になります。',
      clearSelection: '解除',
      marketPrice: '市場価格 (TCGplayer):',
      useThisPrice: 'この価格を使う',
      suggestedApplied: '参考価格を適用しました',
      cardNumber: 'カード番号',
      cardNumberPlaceholder: '例: 199/197, OP15-118, TG12/TG30',
      cardLanguage: 'カード言語',
      cardLanguagePlaceholder: 'EN / JP を選択',
      cardLanguageEn: 'EN - 英語',
      cardLanguageJp: 'JP - 日本語',
      bundleTitle: '複数カードをまとめて販売',
      bundleDesc: '1つの出品で複数カードを掲載',
      listingTitle: '出品タイトル',
      listingTitlePlaceholder: '例: Rare Pokemon Base Set collection',
      listingTitleHint: 'マーケットに表示されるメインタイトルです',
      detailsTitle: '詳細情報',
      publisher: '出版社',
      publisherPlaceholder: '出版社を選択',
      publisherInputPlaceholder: '例: Panini, Topps...',
      setLabel: 'セット / コレクション',
      setPlaceholder: '例: Chrome, Prizm...',
      season: 'シーズン / 年',
      seasonPlaceholder: '例: 2024-25, Season 1...',
      seasonSelectPlaceholder: 'シーズン/年を選択',
      quantity: '数量',
      gradingTitle: '鑑定状態とバリエーション',
      gradingCompany: '鑑定会社',
      raw: 'Raw (未鑑定)',
      finish: 'バリエーション / Finish',
      bundleList: 'カード一覧',
      cardsCount: '{count}枚',
      addCard: 'カード追加',
      cardItemPlaceholder: 'カード名 #{number}, 例: Holo Charizard',
      bundleDisplayPrice: 'マーケット表示価格:',
      bundleTotalValue: '合計価値:',
      bundleAttrsTitle: 'カードごとの属性',
      bundleAttrsHint: '上で値を複数選び、各カードに1つずつ割り当てます（プールから選択）。',
      attrCondition: 'コンディション',
      attrSet: 'セット',
      attrGrading: 'グレード',
      attrLanguage: '言語',
      poolSetPlaceholder: 'セットを追加（例: Base Set）',
      poolGradingPlaceholder: 'グレードを追加（例: PSA 10, raw）',
      poolAddBtn: '追加',
      attrAssignPlaceholder: '選択',
      processingImages: '画像を処理中...',
      imageUploadHint: 'カード全体が収まる縦向きの写真がおすすめです。',
      imageReorderHint: 'ドラッグして並べ替え。最初の写真がカバーになります。',
      coverImageBadge: 'カバー',
      priceUsdPlaceholder: 'USD価格を入力 例: 30',
      priceBundlePlaceholder: 'セット販売価格をVNDで入力',
      priceVndPlaceholder: 'VND価格を入力 例: 700000',
      vndNote: '価格はVNDです。例: 700000 = 700,000đ。',
      usdNote: '出品価格は換算後にVNDで保存・表示されます。',
      inputVndNote: 'VNDで入力してください。例: 10000 = 10,000đ。',
      acceptOffers: 'オファーを受け付ける',
      acceptOffersDesc: '購入者が価格提案を送れるようにします',
      bundleOfferNote: 'オファーはセット全体（ロット単位）に適用され、カード単位ではありません。',
      minOffer: 'この割合未満のオファーは受けない',
      acceptAllOffers: 'すべてのオファーを受ける',
      nearOriginalPrice: '元値に近いオファーのみ',
      payoutNote: '売上に関する注意',
      payoutNoteDesc: 'カードが売れると、売上はCardVerseウォレットに入ります。銀行口座への出金ごとに5%のプラットフォーム手数料が差し引かれます。',
      usdConfirmTitle: '販売価格を確認 (VND換算)',
      usdConfirmDesc: 'USDで入力した価格は、換算後にVNDで出品されます:',
      editPrice: '価格を修正',
      confirmPrice: 'この価格で出品',
    };
  }

  if (locale === 'vi-VN') {
    return {
      fieldLabels: {
        name: 'Tiêu đề', category: 'Danh mục', condition: 'Tình trạng thẻ', publisher: 'Nhà phát hành', setName: 'Set / Bộ sưu tập',
        season: 'Mùa / Năm', quantity: 'Số lượng', grade: 'Điểm grade', gradingCompany: 'Hãng grade',
        cardNumber: 'Số thẻ', language: 'Ngôn ngữ thẻ', price: 'Giá bán', startingBid: 'Giá khởi điểm',
        auctionEnds: 'Ngày kết thúc', ticketPrice: 'Giá vé', totalTickets: 'Tổng số vé', description: 'Mô tả', images: 'Hình ảnh',
      },
      titleMin: 'Tiêu đề cần ít nhất 5 ký tự.',
      chooseCategory: 'Vui lòng chọn danh mục.',
      minSalePrice: `Giá bán tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.`,
      minStartingBid: `Giá khởi điểm tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.`,
      minTicketPrice: `Giá vé tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.`,
      descriptionMin: 'Mô tả cần ít nhất 300 ký tự.',
      minImages: 'Vui lòng tải lên ít nhất 1 ảnh.',
      maxImages: 'Tối đa 4 ảnh.',
      enterPrice: 'Vui lòng nhập giá bán.',
      enterAuction: 'Vui lòng nhập giá khởi điểm và ngày kết thúc.',
      enterRazz: 'Vui lòng nhập giá vé và tổng số vé.',
      choosePublisher: 'Vui lòng chọn nhà phát hành.',
      enterPublisher: 'Vui lòng nhập nhà phát hành.',
      chooseGrade: 'Vui lòng chọn điểm grade.',
      chooseCondition: 'Vui lòng chọn tình trạng thẻ.',
      enterCardNumber: 'Vui lòng nhập số thẻ (vd: 199/197, OP15-118).',
      chooseLanguage: 'Vui lòng chọn ngôn ngữ thẻ (EN/JP).',
      created: 'Đăng bán thành công!',
      createdDesc: 'Thẻ của bạn đã được đăng trên chợ.',
      createErrorTitle: 'Lỗi',
      createErrorDesc: 'Có lỗi khi tạo bài đăng.',
      checkingSeller: 'Đang kiểm tra quyền người bán',
      checkingSellerDesc: 'Vui lòng đợi trong giây lát.',
      kycNeeded: 'Bạn chưa được duyệt KYC',
      kycNeededDesc: 'Hoàn tất xác minh ở trang Seller để bắt đầu đăng bán.',
      addPickup: 'Thêm địa chỉ lấy hàng',
      addPickupDesc: 'Trước khi đăng bán, vui lòng thiết lập địa chỉ lấy hàng của bạn. Chúng tôi cần địa chỉ này để tính cước phí vận chuyển cho người mua.',
      saveAndContinue: 'Lưu địa chỉ & tiếp tục',
      missingTitle: 'Thiếu thông tin',
      missingDesc: 'Vui lòng kiểm tra: {fields}.',
      missingFallback: 'Vui lòng kiểm tra lại các trường còn thiếu.',
      cardIdentityTitle: 'Xác định đúng lá thẻ',
      cardIdentityDesc: 'Chọn thẻ từ catalog để bài đăng gắn đúng lá thẻ và tính giá thị trường VN chính xác hơn.',
      clearSelection: 'Bỏ chọn',
      marketPrice: 'Giá thị trường (TCGplayer):',
      useThisPrice: 'Dùng giá này',
      suggestedApplied: 'Đã áp dụng giá gợi ý',
      cardNumber: 'Số thẻ',
      cardNumberPlaceholder: 'VD: 199/197, OP15-118, TG12/TG30',
      cardLanguage: 'Ngôn ngữ thẻ',
      cardLanguagePlaceholder: 'Chọn EN / JP',
      cardLanguageEn: 'EN - Tiếng Anh',
      cardLanguageJp: 'JP - Tiếng Nhật',
      bundleTitle: 'Bán nhiều thẻ',
      bundleDesc: 'Đăng bán nhiều thẻ trong cùng một bài viết',
      listingTitle: 'Tiêu đề bài bán',
      listingTitlePlaceholder: 'VD: Bộ sưu tập Pokemon Base Set hàng hiếm',
      listingTitleHint: 'Đây là tiêu đề chính hiển thị trên chợ',
      detailsTitle: 'Thông tin chi tiết',
      publisher: 'Nhà phát hành',
      publisherPlaceholder: 'Chọn nhà phát hành',
      publisherInputPlaceholder: 'VD: Panini, Topps...',
      setLabel: 'Set / Bộ sưu tập',
      setPlaceholder: 'VD: Chrome, Prizm...',
      season: 'Mùa / Năm',
      seasonPlaceholder: 'VD: 2024-25, Season 1...',
      seasonSelectPlaceholder: 'Chọn mùa/năm',
      quantity: 'Số lượng',
      gradingTitle: 'Tình trạng grade & biến thể',
      gradingCompany: 'Hãng grade',
      raw: 'Raw (chưa grade)',
      finish: 'Biến thể / Finish',
      bundleList: 'Danh sách thẻ',
      cardsCount: '{count} thẻ',
      addCard: 'Thêm thẻ',
      cardItemPlaceholder: 'Tên thẻ #{number}, VD: Holo Charizard',
      bundleDisplayPrice: 'Giá hiển thị trên chợ:',
      bundleTotalValue: 'Tổng giá trị:',
      bundleAttrsTitle: 'Thuộc tính theo từng thẻ',
      bundleAttrsHint: 'Chọn nhiều giá trị ở đây, rồi gán cho từng thẻ phía dưới (chọn 1 từ pool).',
      attrCondition: 'Tình trạng',
      attrSet: 'Bộ thẻ / Set',
      attrGrading: 'Grading',
      attrLanguage: 'Ngôn ngữ',
      poolSetPlaceholder: 'Thêm set (vd: Base Set)',
      poolGradingPlaceholder: 'Thêm grading (vd: PSA 10, raw)',
      poolAddBtn: 'Thêm',
      attrAssignPlaceholder: 'Chọn',
      processingImages: 'Đang xử lý ảnh...',
      imageUploadHint: 'Nên upload ảnh chiều dọc, chụp trọn 4 góc thẻ để hiển thị đẹp nhất.',
      imageReorderHint: 'Kéo để sắp xếp lại thứ tự. Ảnh đầu tiên là ảnh bìa.',
      coverImageBadge: 'Ảnh bìa',
      priceUsdPlaceholder: 'Nhập giá bằng USD, ví dụ 30',
      priceBundlePlaceholder: 'Nhập giá bán cho cả bộ (VND)',
      priceVndPlaceholder: 'Nhập giá bằng VND, ví dụ 700000',
      vndNote: 'Giá đang dùng đơn vị VND. Ví dụ: 700000 = 700.000đ.',
      usdNote: 'Bài đăng sẽ được lưu và hiển thị bằng VND sau khi quy đổi.',
      inputVndNote: 'Nhập theo VND. Ví dụ: 10000 = 10.000đ.',
      acceptOffers: 'Nhận offer',
      acceptOffersDesc: 'Cho phép người mua gửi đề nghị giá cho thẻ này',
      bundleOfferNote: 'Offer áp dụng cho CẢ LÔ (toàn bộ bundle), không theo từng thẻ.',
      minOffer: 'Không nhận offer dưới',
      acceptAllOffers: 'Nhận mọi offer',
      nearOriginalPrice: 'Chỉ nhận gần giá gốc',
      payoutNote: 'Lưu ý về tiền bán',
      payoutNoteDesc: 'Khi bán được thẻ, tiền sẽ vào ví CardVerse của bạn. Mỗi lần rút tiền về tài khoản ngân hàng sẽ bị trừ 5% phí nền tảng. Bạn có thể cân nhắc mức giá để bù phần phí này.',
      usdConfirmTitle: 'Xác nhận giá bán (quy đổi sang VND)',
      usdConfirmDesc: 'Bạn nhập giá bằng USD. Thẻ sẽ được đăng bán với giá VND sau quy đổi:',
      editPrice: 'Sửa lại giá',
      confirmPrice: 'Đăng bán với giá này',
    };
  }

  return {
    fieldLabels: {
      name: 'Title', category: 'Category', condition: 'Card condition', publisher: 'Publisher', setName: 'Set / Collection',
      season: 'Season / Year', quantity: 'Quantity', grade: 'Grade', gradingCompany: 'Grading company',
      cardNumber: 'Card number', language: 'Card language', price: 'Sale price', startingBid: 'Starting bid',
      auctionEnds: 'End date', ticketPrice: 'Ticket price', totalTickets: 'Total tickets', description: 'Description', images: 'Images',
    },
    titleMin: 'Title must be at least 5 characters.',
    chooseCategory: 'Please choose a category.',
    minSalePrice: `Minimum sale price is ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('en-US')} VND.`,
    minStartingBid: `Minimum starting bid is ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('en-US')} VND.`,
    minTicketPrice: `Minimum ticket price is ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('en-US')} VND.`,
    descriptionMin: 'Description must be at least 300 characters.',
    minImages: 'Please upload at least 1 image.',
    maxImages: 'Maximum 4 images.',
    enterPrice: 'Please enter a sale price.',
    enterAuction: 'Please enter a starting bid and end date.',
    enterRazz: 'Please enter ticket price and total tickets.',
    choosePublisher: 'Please choose a publisher.',
    enterPublisher: 'Please enter a publisher.',
    chooseGrade: 'Please choose a grade.',
    chooseCondition: 'Please choose the card condition.',
    enterCardNumber: 'Please enter a card number (e.g. 199/197, OP15-118).',
    chooseLanguage: 'Please choose the card language (EN/JP).',
    created: 'Listing created',
    createdDesc: 'Your card has been listed on the marketplace.',
    createErrorTitle: 'Error',
    createErrorDesc: 'There was a problem creating your listing.',
    checkingSeller: 'Checking seller access',
    checkingSellerDesc: 'Please wait a moment.',
    kycNeeded: 'KYC has not been approved',
    kycNeededDesc: 'Complete verification on the Seller page before listing cards.',
    addPickup: 'Add pickup address',
    addPickupDesc: 'Before listing, set your pickup address. We need it to calculate shipping fees for buyers.',
    saveAndContinue: 'Save address & continue',
    missingTitle: 'Missing information',
    missingDesc: 'Please check: {fields}.',
    missingFallback: 'Please review the missing fields.',
    cardIdentityTitle: 'Identify the exact card',
    cardIdentityDesc: 'Choose a card from the catalog so the listing is linked correctly and VN market pricing is more accurate.',
    clearSelection: 'Clear',
    marketPrice: 'Market price (TCGplayer):',
    useThisPrice: 'Use this price',
    suggestedApplied: 'Suggested price applied',
    cardNumber: 'Card number',
    cardNumberPlaceholder: 'E.g. 199/197, OP15-118, TG12/TG30',
    cardLanguage: 'Card language',
    cardLanguagePlaceholder: 'Choose EN / JP',
    cardLanguageEn: 'EN - English',
    cardLanguageJp: 'JP - Japanese',
    bundleTitle: 'Sell multiple cards',
    bundleDesc: 'List multiple cards in one listing',
    listingTitle: 'Listing title',
    listingTitlePlaceholder: 'E.g. Rare Pokemon Base Set collection',
    listingTitleHint: 'This is the main title shown in the marketplace',
    detailsTitle: 'Details',
    publisher: 'Publisher',
    publisherPlaceholder: 'Choose publisher',
    publisherInputPlaceholder: 'E.g. Panini, Topps...',
    setLabel: 'Set / Collection',
    setPlaceholder: 'E.g. Chrome, Prizm...',
    season: 'Season / Year',
    seasonPlaceholder: 'E.g. 2024-25, Season 1...',
    seasonSelectPlaceholder: 'Choose season/year',
    quantity: 'Quantity',
    gradingTitle: 'Grading condition & variant',
    gradingCompany: 'Grading company',
    raw: 'Raw (ungraded)',
    finish: 'Variant / Finish',
    bundleList: 'Card list',
    cardsCount: '{count} cards',
    addCard: 'Add card',
    cardItemPlaceholder: 'Card #{number} name, e.g. Holo Charizard',
    bundleDisplayPrice: 'Marketplace display price:',
    bundleTotalValue: 'Total value:',
    bundleAttrsTitle: 'Per-card attributes',
    bundleAttrsHint: 'Pick multiple values here, then assign one to each card below (choose from the pool).',
    attrCondition: 'Condition',
    attrSet: 'Set',
    attrGrading: 'Grading',
    attrLanguage: 'Language',
    poolSetPlaceholder: 'Add a set (e.g. Base Set)',
    poolGradingPlaceholder: 'Add grading (e.g. PSA 10, raw)',
    poolAddBtn: 'Add',
    attrAssignPlaceholder: 'Select',
    processingImages: 'Processing images...',
    imageUploadHint: 'Upload portrait photos with all four card corners visible for the best display.',
    imageReorderHint: 'Drag to reorder. The first photo is the cover.',
    coverImageBadge: 'Cover',
    priceUsdPlaceholder: 'Enter USD price, e.g. 30',
    priceBundlePlaceholder: 'Enter bundle price in VND',
    priceVndPlaceholder: 'Enter VND price, e.g. 700000',
    vndNote: 'Price is in VND. Example: 700000 = 700,000đ.',
    usdNote: 'The listing will be saved and displayed in VND after conversion.',
    inputVndNote: 'Enter VND. Example: 10000 = 10,000đ.',
    acceptOffers: 'Accept offers',
    acceptOffersDesc: 'Allow buyers to send price offers for this card',
    bundleOfferNote: 'Offers apply to the WHOLE LOT (entire bundle), not per card.',
    minOffer: 'Do not accept offers below',
    acceptAllOffers: 'Accept all offers',
    nearOriginalPrice: 'Only near original price',
    payoutNote: 'Seller payout note',
    payoutNoteDesc: 'When a card sells, the money goes to your CardVerse wallet. Each withdrawal to a bank account has a 5% platform fee.',
    usdConfirmTitle: 'Confirm sale price (converted to VND)',
    usdConfirmDesc: 'You entered a USD price. The card will be listed in VND after conversion:',
    editPrice: 'Edit price',
    confirmPrice: 'List with this price',
  };
};

/** Attributes that can vary card-to-card inside a bundle. The seller builds a
 * pool of allowed values for each (multi-select above), then assigns one value
 * per card from that pool — so bundle data stays normalized (no free text). */
const BUNDLE_ATTR_KEYS = ['publisher', 'setName', 'season'] as const;
type BundleAttrKey = (typeof BUNDLE_ATTR_KEYS)[number];
type BundleAttrPools = Record<BundleAttrKey, string[]>;
const EMPTY_BUNDLE_POOLS: BundleAttrPools = { publisher: [], setName: [], season: [] };

/** Individual card in a bundle */
interface BundleItem {
  id: string;
  title: string;
  price: number | undefined;
  attrs: Partial<Record<BundleAttrKey, string>>;
}

const MIN_MARKETPLACE_PRICE_VND = 1000;

function parseVndNumberInput(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/[^\d]/g, '');
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatNumericInput(value: unknown): string {
  const parsed = parseVndNumberInput(value);
  return parsed ? new Intl.NumberFormat('vi-VN').format(parsed) : '';
}

const shouldShowCatalogIdentity = (category?: string, isBundle = false) =>
  !isBundle && (category === 'Pokémon' || category === 'One Piece');

const getFormSchema = (copy: LocaleCopy) => z.object({
  name: z.string().min(5, { message: copy.titleMin }),
  isBundle: z.boolean().default(false),
  category: z.string({ required_error: copy.chooseCategory }),
  publisher: z.string().optional(),
  setName: z.string().optional(),
  season: z.string().optional(),
  quantity: z.preprocess(
    (a) => {
      if (typeof a === 'number') return a;
      if (typeof a === 'string') return parseInt(a, 10) || 1;
      return 1;
    },
    z.number().positive().default(1)
  ),
  condition: z.string().optional(),
  // Card identity (seller-listing standardization): canonical catalog link +
  // collector number + language so completed sales feed the VN market price.
  catalogProductId: z.number().optional(),
  catalogSoccerId: z.number().optional(),
  cardNumber: z.string().optional(),
  language: z.enum(['en', 'jp']).optional(),
  // Grading split out of the old `condition` string (raw vs PSA/BGS/CGC/SGC).
  gradingCompany: z.enum(['raw', 'psa', 'bgs', 'cgc', 'sgc']).default('raw'),
  grade: z.number().min(1).max(10).optional(),
  finish: z.enum(['normal', 'holo', 'reverse', '1st', 'parallel']).default('normal'),
  listingType: z.enum(['sale', 'auction', 'razz']),
  price: z.preprocess(
    (a) => parseVndNumberInput(a),
    z.number().min(MIN_MARKETPLACE_PRICE_VND, { message: copy.minSalePrice }).optional()
  ),
  startingBid: z.preprocess(
    (a) => parseVndNumberInput(a),
    z.number().min(MIN_MARKETPLACE_PRICE_VND, { message: copy.minStartingBid }).optional()
  ),
  auctionEnds: z.string().optional(),
  ticketPrice: z.preprocess(
    (a) => parseVndNumberInput(a),
    z.number().min(MIN_MARKETPLACE_PRICE_VND, { message: copy.minTicketPrice }).optional()
  ),
  totalTickets: z.preprocess(
    (a) => a ? parseInt(z.string().parse(a), 10) : undefined,
    z.number().positive().optional()
  ),
  description: z.string().min(300, { message: copy.descriptionMin }),
  images: z.array(z.instanceof(File)).min(1, copy.minImages).max(4, copy.maxImages),
  // Offer settings
  acceptOffers: z.boolean().default(false),
  minOfferPercent: z.preprocess(
    (a) => {
      if (typeof a === 'number') return a;
      if (typeof a === 'string') return parseInt(a, 10) || 0;
      return 0;
    },
    z.number().min(0).max(99).default(0)
  ),
  // Free text fallbacks for "Khác" category
  freePublisher: z.string().optional(),
  freeSetName: z.string().optional(),
  freeSeason: z.string().optional(),
}).refine(data => {
  if (data.listingType === 'sale') return data.price !== undefined;
  return true;
}, { message: copy.enterPrice, path: ['price'] })
  .refine(data => {
    if (data.listingType === 'auction') return data.startingBid !== undefined && data.auctionEnds !== undefined;
    return true;
  }, { message: copy.enterAuction, path: ['startingBid'] })
  .refine(data => {
    if (data.listingType === 'razz') return data.ticketPrice !== undefined && data.totalTickets !== undefined;
    return true;
  }, { message: copy.enterRazz, path: ['ticketPrice'] })
  // Publisher: bắt buộc theo dropdown ở category thường; ở category "Khác"
  // (free-text) thì thay bằng ô freePublisher. Bundle dùng pool nhiều giá trị
  // (validate riêng), nên bỏ qua hai ràng buộc này.
  .refine(data => {
    if (data.isBundle || isFreeText(data.category)) return true;
    return data.publisher !== undefined && data.publisher !== '';
  }, { message: copy.choosePublisher, path: ['publisher'] })
  .refine(data => {
    if (data.isBundle || !isFreeText(data.category)) return true;
    return !!data.freePublisher && data.freePublisher.trim() !== '';
  }, { message: copy.enterPublisher, path: ['freePublisher'] })
  .refine(data => {
    if (data.gradingCompany !== 'raw') return data.grade !== undefined;
    return true;
  }, { message: copy.chooseGrade, path: ['grade'] })
  .refine(data => {
    if (data.gradingCompany === 'raw') return data.condition !== undefined && data.condition !== null && data.condition !== '';
    return true;
  }, { message: copy.chooseCondition, path: ['condition'] })
  // Single-card listings in catalog-backed categories must carry a collector
  // number (the identity key for VN market pricing). Bundles are exempt.
  .refine(data => {
    if (shouldShowCatalogIdentity(data.category, data.isBundle)) {
      return !!data.cardNumber && data.cardNumber.trim() !== '';
    }
    return true;
  }, { message: copy.enterCardNumber, path: ['cardNumber'] })
  .refine(data => {
    if (shouldShowCatalogIdentity(data.category, data.isBundle)) {
      return data.language !== undefined;
    }
    return true;
  }, { message: copy.chooseLanguage, path: ['language'] });


export default function CreateListingPage() {
  const { t, locale } = useLocalization();
  const { user } = useUser();
  const { setOpen } = useAuthModal();
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSellerAccess, setIsCheckingSellerAccess] = useState(true);
  const [hasSellerAccess, setHasSellerAccess] = useState(false);
  const [hasPickupAddress, setHasPickupAddress] = useState(false);
  const supabase = useSupabase();

  const copy = getLocaleCopy(locale);
  const formSchema = getFormSchema(copy);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      listingType: 'sale',
      description: "",
      images: [],
      price: undefined,
      startingBid: undefined,
      auctionEnds: undefined,
      ticketPrice: undefined,
      totalTickets: undefined,
      condition: undefined,
      catalogProductId: undefined,
      catalogSoccerId: undefined,
      cardNumber: "",
      language: undefined,
      gradingCompany: 'raw',
      grade: undefined,
      finish: 'normal',
      publisher: undefined,
      setName: "",
      season: "",
      quantity: 1,
      isBundle: false,
      acceptOffers: false,
      minOfferPercent: 0,
      freePublisher: "",
      freeSetName: "",
      freeSeason: "",
    },
  });

  const listingType = form.watch('listingType');
  const gradingCompany = form.watch('gradingCompany');
  const isGraded = gradingCompany !== 'raw';
  const images = form.watch('images');
  const [dragImageIndex, setDragImageIndex] = useState<number | null>(null);
  const selectedCategory = form.watch('category');
  const selectedPublisher = form.watch('publisher');
  const acceptOffers = form.watch('acceptOffers');
  const watchedPrice = form.watch('price');
  const isBundle = form.watch('isBundle');

  // Bundle items state (managed outside react-hook-form for flexibility)
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([
    { id: crypto.randomUUID(), title: '', price: undefined, attrs: {} },
    { id: crypto.randomUUID(), title: '', price: undefined, attrs: {} },
  ]);
  // Per-attribute value pools the seller defines once and assigns per card.
  const [bundlePools, setBundlePools] = useState<BundleAttrPools>(EMPTY_BUNDLE_POOLS);

  const addBundleItem = () => {
    setBundleItems(prev => [...prev, { id: crypto.randomUUID(), title: '', price: undefined, attrs: {} }]);
  };

  const removeBundleItem = (id: string) => {
    if (bundleItems.length <= 2) return; // minimum 2 items in a bundle
    setBundleItems(prev => prev.filter(item => item.id !== id));
  };

  const updateBundleItem = (id: string, field: 'title' | 'price', value: string) => {
    setBundleItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (field === 'price') {
        return { ...item, price: parseVndNumberInput(value) };
      }
      return { ...item, [field]: value };
    }));
  };

  const updateBundleItemAttr = (id: string, key: BundleAttrKey, value: string) => {
    setBundleItems(prev => prev.map(item => (
      item.id === id ? { ...item, attrs: { ...item.attrs, [key]: value || undefined } } : item
    )));
  };

  // Add/remove a value from an attribute pool. Removing a value also clears it
  // from any card that had it assigned, so cards never reference a dead option.
  const addBundlePoolValue = (key: BundleAttrKey, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    setBundlePools(prev => (prev[key].includes(value) ? prev : { ...prev, [key]: [...prev[key], value] }));
  };

  const removeBundlePoolValue = (key: BundleAttrKey, value: string) => {
    setBundlePools(prev => ({ ...prev, [key]: prev[key].filter(v => v !== value) }));
    setBundleItems(prev => prev.map(item => (
      item.attrs[key] === value ? { ...item, attrs: { ...item.attrs, [key]: undefined } } : item
    )));
  };

  const toggleBundlePoolValue = (key: BundleAttrKey, value: string) => {
    if (bundlePools[key].includes(value)) {
      removeBundlePoolValue(key, value);
    } else {
      addBundlePoolValue(key, value);
    }
  };

  // Local input state for free-text pool adds (used for the "Khác" category).
  const [poolDraft, setPoolDraft] = useState<Record<BundleAttrKey, string>>({ publisher: '', setName: '', season: '' });

  // Computed bundle price range
  const bundlePriceRange = (() => {
    const prices = bundleItems.map(i => i.price).filter((p): p is number => p !== undefined && p > 0);
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices), total: prices.reduce((a, b) => a + b, 0) };
  })();

  // DB-driven sets state
  const [dbGroupedSets, setDbGroupedSets] = useState<GroupedSets>({ en: [], jp: [], other: [] });
  const [loadingDbSets, setLoadingDbSets] = useState(false);

  // Derived state from catalog
  const categoryConfig = selectedCategory ? getCategoryConfig(selectedCategory) : undefined;
  const availablePublishers = selectedCategory ? getPublishers(selectedCategory) : [];
  const staticSets = selectedCategory ? getStaticSets(selectedCategory, selectedPublisher) : [];
  const useDbSets = selectedCategory ? isDbSets(selectedCategory) : false;
  const availableSeasons = selectedCategory ? getSeasons(selectedCategory) : [];
  const singlePublisher = selectedCategory ? isSinglePublisher(selectedCategory) : false;
  const freeTextMode = selectedCategory ? isFreeText(selectedCategory) : false;

  useEffect(() => {
    if (!user) {
      setOpen(true);
    }
  }, [user, setOpen]);

  useEffect(() => {
    if (!user) {
      setIsCheckingSellerAccess(false);
      setHasSellerAccess(false);
      return;
    }

    const checkSellerAccess = async () => {
      try {
        const res = await fetch('/api/seller/verify');
        const data = await res.json();
        const approved = data.verification?.status === 'approved';
        setHasSellerAccess(approved);
        if (!approved) {
          toast({
            variant: 'destructive',
            title: 'Truy cập bị từ chối',
            description: 'Bạn cần hoàn tất và được duyệt KYC trước khi đăng bán.',
          });
          router.replace('/sell');
          return;
        }

        // Approved sellers must have a pickup address on file before listing,
        // otherwise we can't calculate shipping fees for buyers.
        const { data: profile } = await supabase
          .from('profiles')
          .select('address_district_id, address_ward_code')
          .eq('id', user.id)
          .single();
        const p = profile as Record<string, any> | null;
        setHasPickupAddress(!!(p?.address_district_id && p?.address_ward_code));
      } catch {
        setHasSellerAccess(false);
        router.replace('/sell');
      } finally {
        setIsCheckingSellerAccess(false);
      }
    };

    checkSellerAccess();
  }, [user, router, toast]);

  useEffect(() => {
    if (isGraded) {
      // Graded cards don't use the raw-condition select; placeholder keeps the
      // old condition-required validation paths quiet.
      form.setValue('condition', 'Graded');
      form.clearErrors('condition');
    } else {
      if (['Graded', 'PSA Graded'].includes(form.getValues('condition') || '')) {
        form.setValue('condition', undefined);
      }
    }
  }, [isGraded, form]);

  // Handle category change: reset fields, auto-set publisher, fetch DB sets
  const prevCategoryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedCategory === prevCategoryRef.current) return;
    prevCategoryRef.current = selectedCategory;

    if (!selectedCategory) return;

    // Reset dependent fields
    form.setValue('setName', undefined);
    form.setValue('season', undefined);

    // Auto-set publisher for single-publisher categories
    const pubs = getPublishers(selectedCategory);
    if (pubs.length === 1) {
      form.setValue('publisher', pubs[0]);
    }

    // Fetch DB-driven sets (Pokemon, One Piece)
    if (isDbSets(selectedCategory)) {
      setLoadingDbSets(true);
      fetchDbSetsGrouped(selectedCategory).then(grouped => {
        setDbGroupedSets(grouped);
        setLoadingDbSets(false);
      });
    } else {
      setDbGroupedSets({ en: [], jp: [], other: [] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // When publisher changes (for multi-publisher categories like Soccer), reset set
  const prevPublisherRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedPublisher === prevPublisherRef.current) return;
    prevPublisherRef.current = selectedPublisher;
    // Only reset set if publisher actually changed by user (not auto-set)
    if (selectedPublisher && !isSinglePublisher(selectedCategory)) {
      form.setValue('setName', undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPublisher]);

  const categories = getCategories(locale);

  const conditions = locale === 'en-US'
    ? ['Mint', 'Near Mint', 'Excellent', 'Good', 'Played']
    : ['Hoàn hảo', 'Gần như mới', 'Tuyệt vời', 'Tốt', 'Đã qua sử dụng'];

  // Per-card bundle attribute labels + which attributes currently have a pool.
  const bundleAttrLabels: Record<BundleAttrKey, string> = {
    publisher: copy.publisher,
    setName: copy.setLabel,
    season: copy.season,
  };
  const activeBundleAttrKeys = BUNDLE_ATTR_KEYS.filter(key => bundlePools[key].length > 0);

  // ── Bundle pool render helpers (multi-select from the Detail section) ──
  const renderPoolChips = (key: BundleAttrKey) => (
    bundlePools[key].length > 0 ? (
      <div className="flex flex-wrap gap-1.5 pt-1">
        {bundlePools[key].map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
            {v}
            <button type="button" onClick={() => removeBundlePoolValue(key, v)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
    ) : null
  );

  const renderPoolToggle = (key: BundleAttrKey, options: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o}
          type="button"
          onClick={() => toggleBundlePoolValue(key, o)}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${bundlePools[key].includes(o) ? 'border-primary bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40'}`}
        >
          {o}
        </button>
      ))}
    </div>
  );

  const renderPoolTextAdd = (key: BundleAttrKey, placeholder: string) => (
    <>
      <div className="flex gap-2">
        <Input
          value={poolDraft[key]}
          onChange={(e) => setPoolDraft(p => ({ ...p, [key]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBundlePoolValue(key, poolDraft[key]); setPoolDraft(p => ({ ...p, [key]: '' })); } }}
          placeholder={placeholder}
          className="h-9 text-sm"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => { addBundlePoolValue(key, poolDraft[key]); setPoolDraft(p => ({ ...p, [key]: '' })); }}>
          {copy.poolAddBtn}
        </Button>
      </div>
      {renderPoolChips(key)}
    </>
  );

  const [isProcessingImages, setIsProcessingImages] = useState(false);

  // Sell-price currency. Listings are always STORED in VND (the whole
  // marketplace/escrow/GHN/PayOS runs in VND). If the seller prices in USD we
  // convert to VND on input and ask them to confirm the VND amount before posting.
  const [priceCurrency, setPriceCurrency] = useState<'VND' | 'USD'>('VND');
  const [priceInput, setPriceInput] = useState(''); // raw text the seller typed, in priceCurrency
  const [showUsdConfirm, setShowUsdConfirm] = useState(false);
  const [pendingValues, setPendingValues] = useState<z.infer<typeof formSchema> | null>(null);

  // Convert the typed amount into the VND value we actually store.
  const priceInputNumber = parseVndNumberInput(priceInput) ?? 0;
  const formattedPriceInput = formatNumericInput(priceInput);
  const convertedVnd = priceCurrency === 'USD'
    ? Math.round(priceInputNumber * USD_TO_VND_RATE)
    : priceInputNumber;

  // Keep the form's `price` (always VND) in sync with the typed value + unit.
  const applyPrice = (raw: string, currency: 'VND' | 'USD') => {
    const num = parseVndNumberInput(raw) ?? 0;
    setPriceInput(num > 0 ? String(num) : '');
    const vnd = currency === 'USD' ? Math.round(num * USD_TO_VND_RATE) : num;
    form.setValue('price', vnd > 0 ? vnd : undefined, { shouldValidate: true });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const currentFiles = form.getValues('images') || [];
    const slots = Math.max(0, 4 - currentFiles.length);
    if (slots === 0) return;
    const incoming = Array.from(files).slice(0, slots);

    setIsProcessingImages(true);
    try {
      // Convert HEIC → JPEG, then downscale/compress so uploads stay small and fast.
      const processed = await Promise.all(
        incoming.map(async (file) => {
          let f = file;
          if (isHeicFile(f)) {
            try {
              f = await convertHeicToJpeg(f);
            } catch {
              toast({
                variant: 'destructive',
                title: 'Không đọc được ảnh',
                description: 'Vui lòng thử lại hoặc chọn ảnh JPG/PNG.',
              });
              return null;
            }
          }
          try {
            return await compressImage(f);
          } catch {
            return f; // compression is best-effort
          }
        })
      );

      const valid = processed.filter((f): f is File => f !== null);
      const combined = [...currentFiles, ...valid].slice(0, 4);
      form.setValue('images', combined, { shouldValidate: true });
    } finally {
      setIsProcessingImages(false);
    }
  };

  /** Handle card picked from the collection dialog — auto-fill form fields */
  const handleCardPicked = (card: SelectedCatalogCard) => {
    // Set category (this triggers the useEffect to fetch sets)
    form.setValue('category', card.category);
    prevCategoryRef.current = card.category;

    // Set publisher
    form.setValue('publisher', card.publisher);

    // Set name
    form.setValue('name', card.name);

    // Set the set name (with slight delay to let category effect settle)
    setTimeout(() => {
      form.setValue('setName', card.setName);
    }, 100);

    // Fetch DB sets for the selected category
    if (isDbSets(card.category)) {
      setLoadingDbSets(true);
      fetchDbSetsGrouped(card.category).then(grouped => {
        setDbGroupedSets(grouped);
        setLoadingDbSets(false);
        // Set the setName after data is loaded
        form.setValue('setName', card.setName);
      });
    }

    toast({
      title: '✅ Đã điền thông tin',
      description: `${card.name} — ${card.setName}`,
    });
  };

  // Catalog pick state — the canonical card identity behind this listing.
  const [catalogPick, setCatalogPick] = useState<CatalogPick | null>(null);
  const showCatalogIdentity = shouldShowCatalogIdentity(selectedCategory, isBundle);

  /** Seller picked the EXACT card from the real catalog — lock in its identity. */
  const handleCatalogPicked = (pick: CatalogPick, tab: CatalogTabId) => {
    setCatalogPick(pick);

    const category = catalogTabToCategory(tab);
    form.setValue('category', category);
    prevCategoryRef.current = category;

    // We set prevCategoryRef above, which suppresses the category effect — so
    // auto-set the publisher here (single-publisher categories like Pokémon /
    // One Piece) exactly as that effect would, otherwise validation fails.
    const pubs = getPublishers(category);
    if (pubs.length === 1) {
      form.setValue('publisher', pubs[0]);
    }

    form.setValue('name', pick.name);
    form.setValue('catalogProductId', pick.productId);
    form.setValue('catalogSoccerId', pick.soccerId);
    form.setValue('cardNumber', pick.number || '');
    form.setValue('language', pick.language || undefined);
    form.clearErrors(['cardNumber', 'language', 'name', 'category', 'publisher']);

    // Mirror handleCardPicked's set-name handling: let the category effect
    // settle, then apply the catalog set name.
    if (pick.setName) {
      setTimeout(() => form.setValue('setName', pick.setName || ''), 100);
      if (isDbSets(category)) {
        setLoadingDbSets(true);
        fetchDbSetsGrouped(category).then(grouped => {
          setDbGroupedSets(grouped);
          setLoadingDbSets(false);
          form.setValue('setName', pick.setName || '');
        });
      }
    }

    toast({
      title: '✅ Đã gắn thẻ catalog',
      description: `${pick.name}${pick.number ? ` · #${pick.number}` : ''}${pick.language ? ` · ${pick.language.toUpperCase()}` : ''}`,
    });
  };

  const clearCatalogPick = () => {
    setCatalogPick(null);
    form.setValue('catalogProductId', undefined);
    form.setValue('catalogSoccerId', undefined);
  };

  useEffect(() => {
    if (showCatalogIdentity) return;
    setCatalogPick(null);
    form.setValue('catalogProductId', undefined);
    form.setValue('catalogSoccerId', undefined);
    form.setValue('cardNumber', '');
    form.setValue('language', undefined);
    form.clearErrors(['cardNumber', 'language']);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCatalogIdentity]);

  const removeImage = (index: number) => {
    const currentFiles = form.getValues('images') || [];
    const newFiles = currentFiles.filter((_, i) => i !== index);
    form.setValue('images', newFiles, { shouldValidate: true });
  };

  // Drag-to-reorder previews. The first image is the listing cover, so letting
  // sellers reorder lets them pick which photo leads.
  const moveImage = (from: number, to: number) => {
    if (from === to) return;
    const currentFiles = [...(form.getValues('images') || [])];
    if (from < 0 || from >= currentFiles.length || to < 0 || to >= currentFiles.length) return;
    const [moved] = currentFiles.splice(from, 1);
    currentFiles.splice(to, 0, moved);
    form.setValue('images', currentFiles, { shouldValidate: true });
  };

  // Gate the real submit: if the seller priced in USD, confirm the converted
  // VND amount first (handleSubmit has already validated by this point).
  function onSubmit(values: z.infer<typeof formSchema>) {
    if (values.listingType === 'sale' && priceCurrency === 'USD' && (values.price ?? 0) > 0) {
      setPendingValues(values);
      setShowUsdConfirm(true);
      return;
    }
    void submitListing(values);
  }

  async function submitListing(values: z.infer<typeof formSchema>) {
    if (!user) {
      setOpen(true);
      return;
    }
    if (!hasSellerAccess) {
      toast({
        variant: 'destructive',
        title: 'Seller verification required',
        description: 'Bạn cần được duyệt KYC trước khi tạo bài đăng.',
      });
      return;
    }

    // Validate bundle BEFORE uploading images so the user isn't made to wait
    // for an upload that will be rejected anyway.
    if (values.isBundle) {
      const validItems = bundleItems.filter(i => i.title.trim() && i.price && i.price > 0);
      if (validItems.length < 2) {
        toast({
          variant: 'destructive',
          title: 'Lỗi',
          description: 'Bán nhiều thẻ cần ít nhất 2 thẻ với đầy đủ tên và giá.',
        });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Upload all images directly browser → Cloudinary, in parallel.
      // (HEIC conversion + compression already happened at selection time.)
      const signature = await getCloudinarySignature('cardverse/cards');
      const uploadedUrls = await Promise.all(
        values.images.map(async (image) => {
          const { secureUrl } = await uploadImageDirectToCloudinary(image, signature);
          return secureUrl;
        })
      );

      // Back-compat: old UI reads `condition`, so graded cards keep the
      // "PSA 10"-style string while the structured fields carry the truth.
      const finalCondition = values.gradingCompany !== 'raw'
        ? `${values.gradingCompany.toUpperCase()} ${values.grade}`
        : values.condition;

      // Resolve publisher/set/season — for bundles these come from the pools
      // (use the first selected value as the listing-level representative),
      // otherwise from the single dropdowns or free text.
      const resolvedPublisher = values.isBundle
        ? (bundlePools.publisher[0] || (freeTextMode ? 'Khác' : ''))
        : freeTextMode
          ? (values.freePublisher || 'Khác')
          : values.publisher;
      const resolvedSetName = values.isBundle
        ? (bundlePools.setName[0] || '')
        : freeTextMode
          ? (values.freeSetName || '')
          : (values.setName || '');
      const resolvedSeason = values.isBundle
        ? (bundlePools.season[0] || '')
        : freeTextMode
          ? (values.freeSeason || '')
          : (values.season || '');

      const cardData: any = {
        seller_id: user.id,
        name: values.name,
        category: values.category,
        condition: finalCondition,
        description: values.description,
        listing_type: values.listingType,
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        publisher: resolvedPublisher,
        set_name: resolvedSetName,
        season: resolvedSeason,
        quantity: values.isBundle ? bundleItems.filter(i => i.title.trim()).length : (values.quantity || 1),
        status: 'active',
        // Canonical card identity for VN market pricing (null on bundles).
        catalog_product_id: values.isBundle ? null : (values.catalogProductId ?? null),
        catalog_soccer_id: values.isBundle ? null : (values.catalogSoccerId ?? null),
        card_number: values.isBundle ? null : (values.cardNumber?.trim() || null),
        language: values.isBundle ? null : (values.language ?? null),
        grading_company: values.gradingCompany,
        grade: values.gradingCompany !== 'raw' ? values.grade : null,
        finish: values.finish,
      };

      // Add offer fields if enabled
      if (values.acceptOffers) {
        cardData.accept_offers = true;
        cardData.min_offer_percent = values.minOfferPercent || 0;
      }

      // Add bundle fields if enabled
      if (values.isBundle) {
        cardData.is_bundle = true;
        cardData.bundle_items = bundleItems
          .filter(i => i.title.trim() && i.price && i.price > 0)
          .map(i => {
            const entry: Record<string, unknown> = { title: i.title.trim(), price: i.price };
            // Only persist attributes whose value still exists in its pool, so a
            // removed pool option never leaves a dangling value on a card.
            for (const key of BUNDLE_ATTR_KEYS) {
              const value = i.attrs[key];
              if (value && bundlePools[key].includes(value)) entry[key] = value;
            }
            return entry;
          });
      }

      if (values.listingType === 'sale') {
        cardData.price = values.price;
      } else if (values.listingType === 'auction') {
        cardData.current_bid = values.startingBid;
        cardData.starting_bid = values.startingBid;
        cardData.auction_ends = new Date(values.auctionEnds!).toISOString();
      } else if (values.listingType === 'razz') {
        cardData.ticket_price = values.ticketPrice;
        cardData.total_tickets = values.totalTickets;
        cardData.razz_entries = 0;
      }

      const res = await fetch('/api/marketplace/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardData),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create listing');
      }

      toast({
        title: copy.created,
        description: copy.createdDesc,
      });

      router.push('/buy');

    } catch (error: any) {
      console.error("Error creating listing: ", error);
      toast({
        variant: "destructive",
        title: copy.createErrorTitle,
        description: error.message || copy.createErrorDesc,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const renderContent = () => {
    if (!user) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <ShieldAlert className="h-16 w-16 text-primary mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{t('auth_required_title')}</h2>
          <p className="text-muted-foreground">{t('auth_required_desc')}</p>
        </div>
      );
    }

    if (isCheckingSellerAccess) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <h2 className="text-xl font-semibold mb-2">{copy.checkingSeller}</h2>
          <p className="text-muted-foreground">{copy.checkingSellerDesc}</p>
        </div>
      );
    }

    if (!hasSellerAccess) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <ShieldAlert className="h-16 w-16 text-primary mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{copy.kycNeeded}</h2>
          <p className="text-muted-foreground">{copy.kycNeededDesc}</p>
        </div>
      );
    }

    // Approved sellers must set a pickup address before they can list anything —
    // shipping fees are calculated from this address.
    if (!hasPickupAddress) {
      return (
        <div className="space-y-6 py-4">
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-full bg-orange-500/10 flex items-center justify-center mb-3">
              <MapPin className="h-7 w-7 text-orange-500" />
            </div>
            <h2 className="text-2xl font-semibold mb-1">{copy.addPickup}</h2>
            <p className="text-muted-foreground max-w-md">
              {copy.addPickupDesc}
            </p>
          </div>
          <div className="max-w-xl mx-auto rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
            <SellerAddressForm
              submitLabel={copy.saveAndContinue}
              onSaved={() => setHasPickupAddress(true)}
            />
          </div>
        </div>
      );
    }

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
          const missing = Object.keys(errors)
            .map((key) => copy.fieldLabels[key] || key);
          toast({
            variant: 'destructive',
            title: copy.missingTitle,
            description: missing.length
              ? copy.missingDesc.replace('{fields}', missing.join(', '))
              : copy.missingFallback,
          });
          // Radix Select không nhận focus nên cuộn thủ công tới ô lỗi đầu tiên.
          setTimeout(() => {
            const el = document.querySelector('[aria-invalid="true"]');
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
        })} className="space-y-8">

          {showCatalogIdentity && (
            <div className="space-y-3 p-4 rounded-xl border border-dashed border-orange-500/30 bg-orange-500/5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-orange-500">{copy.cardIdentityTitle}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {copy.cardIdentityDesc}
                  </p>
                </div>
                <div className="flex gap-2">
                  <CatalogCardPicker onSelect={handleCatalogPicked} />
                  <CardPickerDialog onSelect={handleCardPicked} />
                </div>
              </div>

              {catalogPick && (
                <div className="space-y-2 rounded-lg border border-orange-500/40 bg-background/60 p-3">
                  <div className="flex items-center gap-3">
                    {catalogPick.imageUrl && (
                      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded">
                        <Image src={catalogPick.imageUrl} alt="" fill className="object-contain" sizes="40px" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-semibold">{catalogPick.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {catalogPick.setName}
                        {catalogPick.number ? ` · #${catalogPick.number}` : ''}
                        {catalogPick.language ? ` · ${catalogPick.language.toUpperCase()}` : ''}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={clearCatalogPick} className="shrink-0 text-muted-foreground">
                      <X className="mr-1 h-3.5 w-3.5" /> {copy.clearSelection}
                    </Button>
                  </div>

                  {!!catalogPick.marketPrice && catalogPick.marketPrice > 0 && (() => {
                    const suggestedVnd = Math.round((catalogPick.marketPrice * USD_TO_VND_RATE) / 1000) * 1000;
                    return (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-accent/30 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{copy.marketPrice}</span>
                        <span className="font-semibold">${catalogPick.marketPrice}</span>
                        <span className="font-semibold text-orange-400">
                          ≈ {new Intl.NumberFormat('vi-VN').format(suggestedVnd)}đ
                        </span>
                        {listingType === 'sale' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 border-orange-500/40 text-orange-500 hover:border-orange-500"
                            onClick={() => {
                              setPriceCurrency('VND');
                              applyPrice(String(suggestedVnd), 'VND');
                              toast({ title: copy.suggestedApplied, description: `${new Intl.NumberFormat('vi-VN').format(suggestedVnd)}đ` });
                            }}
                          >
                            {copy.useThisPrice}
                          </Button>
                        )}
                      </div>
                    );
                  })()}

                  <VnMarketPrice productId={catalogPick.productId} soccerId={catalogPick.soccerId} />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="cardNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">{copy.cardNumber}</FormLabel>
                      <FormControl>
                        <Input placeholder={copy.cardNumberPlaceholder} {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">{copy.cardLanguage}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={copy.cardLanguagePlaceholder} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="en">{copy.cardLanguageEn}</SelectItem>
                          <SelectItem value="jp">{copy.cardLanguageJp}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}

          {/* ─── Bundle Toggle ─── */}
          <FormField
            control={form.control}
            name="isBundle"
            render={({ field }) => (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <FormItem className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Layers className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <FormLabel className="text-base font-semibold cursor-pointer">{copy.bundleTitle}</FormLabel>
                      <p className="text-xs text-muted-foreground mt-0.5">{copy.bundleDesc}</p>
                    </div>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              </div>
            )}
          />

          {/* Card Title (Main) */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>
                  {isBundle ? copy.listingTitle : t('card_title_label')}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={isBundle ? copy.listingTitlePlaceholder : t('card_title_placeholder')}
                    {...field}
                  />
                </FormControl>
                {isBundle && (
                  <p className="text-xs text-muted-foreground">{copy.listingTitleHint}</p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Category & Condition */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('category_label')}</FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                    }}
                    value={field.value ?? ''}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('category_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="condition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('condition_label')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''} disabled={isGraded}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('condition_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {conditions.map(cond => <SelectItem key={cond} value={cond}>{cond}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ─── Dynamic Publisher / Set / Season Section ─── */}
          {selectedCategory && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                <h3 className="text-base font-semibold text-primary">
                  {copy.detailsTitle} - {categoryConfig?.label || selectedCategory}
                </h3>
              </div>

              {isBundle ? (
                /* ─── Bundle: multi-select pools, assigned per card below ─── */
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">{copy.bundleAttrsHint}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Publisher pool */}
                    <div className="space-y-1.5">
                      <FormLabel>{copy.publisher}</FormLabel>
                      {freeTextMode
                        ? renderPoolTextAdd('publisher', copy.publisherInputPlaceholder)
                        : renderPoolToggle('publisher', availablePublishers)}
                    </div>
                    {/* Set pool */}
                    <div className="space-y-1.5">
                      <FormLabel>{copy.setLabel}</FormLabel>
                      {freeTextMode ? (
                        renderPoolTextAdd('setName', copy.setPlaceholder)
                      ) : (
                        <>
                          <SearchableSetPicker
                            value={undefined}
                            onChange={(val) => { if (val) addBundlePoolValue('setName', val); }}
                            groupedSets={useDbSets ? dbGroupedSets : undefined}
                            flatSets={!useDbSets ? staticSets : undefined}
                            loading={loadingDbSets}
                            disabled={loadingDbSets}
                          />
                          {renderPoolChips('setName')}
                        </>
                      )}
                    </div>
                    {/* Season pool */}
                    {(freeTextMode || categoryConfig?.hasSeasons) && (
                      <div className="space-y-1.5">
                        <FormLabel>{copy.season}</FormLabel>
                        {freeTextMode
                          ? renderPoolTextAdd('season', copy.seasonPlaceholder)
                          : renderPoolToggle('season', availableSeasons)}
                      </div>
                    )}
                  </div>
                </div>
              ) : freeTextMode ? (
                /* ─── Free Text Mode (for "Khác" category) ─── */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="freePublisher"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{copy.publisher}</FormLabel>
                        <FormControl>
                          <Input placeholder={copy.publisherInputPlaceholder} {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeSetName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{copy.setLabel}</FormLabel>
                        <FormControl>
                          <Input placeholder={copy.setPlaceholder} {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeSeason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{copy.season}</FormLabel>
                        <FormControl>
                          <Input placeholder={copy.seasonPlaceholder} {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                /* ─── Structured Dropdowns ─── */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Publisher */}
                  <FormField
                    control={form.control}
                    name="publisher"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{copy.publisher}</FormLabel>
                        {singlePublisher ? (
                          <div className="h-10 px-3 py-2 rounded-md border bg-muted text-sm flex items-center">
                            {availablePublishers[0]}
                          </div>
                        ) : (
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={copy.publisherPlaceholder} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availablePublishers.map(pub => (
                                <SelectItem key={pub} value={pub}>{pub}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Set Name */}
                  <FormField
                    control={form.control}
                    name="setName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{copy.setLabel}</FormLabel>
                        <FormControl>
                          <SearchableSetPicker
                            value={field.value || undefined}
                            onChange={field.onChange}
                            groupedSets={useDbSets ? dbGroupedSets : undefined}
                            flatSets={!useDbSets ? staticSets : undefined}
                            loading={loadingDbSets}
                            disabled={loadingDbSets}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Season (only if category uses seasons) */}
                  {categoryConfig?.hasSeasons ? (
                    <FormField
                      control={form.control}
                      name="season"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{copy.season}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={copy.seasonSelectPlaceholder} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableSeasons.map(season => (
                                <SelectItem key={season} value={season}>{season}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    /* Quantity fills the 3rd column when no season */
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{copy.quantity}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              placeholder="1"
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* If has seasons, show quantity on a separate row */}
              {categoryConfig?.hasSeasons && !freeTextMode && !isBundle && (
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem className="max-w-[200px]">
                      <FormLabel>{copy.quantity}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="1"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          )}

          {/* Quantity standalone (only when no category selected yet) */}
          {!selectedCategory && (
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem className="max-w-[200px]">
                  <FormLabel className='text-lg font-semibold'>{copy.quantity}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      placeholder="1"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* ─── Phần 2: Grading & biến thể (tách khỏi condition) ─── */}
          <div className="space-y-4 rounded-xl border p-4">
            <h3 className="text-lg font-semibold">{copy.gradingTitle}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="gradingCompany"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">{copy.gradingCompany}</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (value !== 'raw' && form.getValues('grade') === undefined) {
                          form.setValue('grade', 10);
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={copy.raw} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="raw">{copy.raw}</SelectItem>
                        <SelectItem value="psa">PSA</SelectItem>
                        <SelectItem value="bgs">BGS</SelectItem>
                        <SelectItem value="cgc">CGC</SelectItem>
                        <SelectItem value="sgc">SGC</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="finish"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">{copy.finish}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Normal" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="holo">Holo</SelectItem>
                        <SelectItem value="reverse">Reverse Holo</SelectItem>
                        <SelectItem value="1st">1st Edition</SelectItem>
                        <SelectItem value="parallel">Parallel</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isGraded && (
              <FormField
                control={form.control}
                name="grade"
                render={({ field }) => (
                  <FormItem className="rounded-lg border p-4">
                    <div className="flex justify-between items-center">
                      <FormLabel className="text-lg font-semibold">{gradingCompany.toUpperCase()} Grade</FormLabel>
                      <span className="w-12 text-center text-lg font-bold text-primary rounded-md bg-muted px-2 py-1">{field.value ?? 10}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={1}
                        max={10}
                        step={0.5}
                        value={[field.value ?? 10]}
                        onValueChange={(value) => field.onChange(value[0])}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          {/* Images */}
          <FormField
            control={form.control}
            name="images"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>{t('images_label')}</FormLabel>
                <p className="text-sm text-muted-foreground">{copy.imageUploadHint}</p>
                <FormControl>
                  <div
                    className='border-2 border-dashed border-muted rounded-lg p-8 text-center cursor-pointer'
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFiles(e.dataTransfer.files);
                    }}
                    onClick={() => document.getElementById('image-upload')?.click()}
                  >
                    {isProcessingImages ? (
                      <Loader2 className='mx-auto h-12 w-12 text-muted-foreground animate-spin' />
                    ) : (
                      <Upload className='mx-auto h-12 w-12 text-muted-foreground' />
                    )}
                    <p className='mt-4 text-muted-foreground'>
                      {isProcessingImages ? copy.processingImages : t('images_description')}
                    </p>
                    <Input
                      type="file"
                      className='sr-only'
                      id="image-upload"
                      multiple
                      onChange={(e) => handleFiles(e.target.files)}
                      accept={"image/jpeg,image/jpg,image/png,image/webp"}
                    />
                    <Button variant="outline" type="button" className="mt-4">
                      {t('browse_files')}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
                {images && images.length > 0 && (
                  <>
                    <p className="mt-4 text-xs text-muted-foreground">{copy.imageReorderHint}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-2">
                      {images.map((file, index) => (
                        <div
                          key={index}
                          draggable
                          onDragStart={() => setDragImageIndex(index)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragImageIndex !== null) moveImage(dragImageIndex, index);
                            setDragImageIndex(null);
                          }}
                          onDragEnd={() => setDragImageIndex(null)}
                          className={`relative group aspect-square cursor-move rounded-md ring-2 transition-all ${
                            dragImageIndex === index ? 'opacity-50 ring-orange-500' : 'ring-transparent'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`preview ${index}`}
                            className="object-contain rounded-md w-full h-full bg-black/20 p-2 pointer-events-none"
                          />
                          <span className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            index === 0 ? 'bg-orange-500 text-white' : 'bg-black/60 text-white'
                          }`}>
                            {index === 0 ? copy.coverImageBadge : `#${index + 1}`}
                          </span>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeImage(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </FormItem>
            )}
          />

          {/* Listing Type */}
          <FormField
            control={form.control}
            name="listingType"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel className='text-lg font-semibold'>{t('listing_type_label')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="flex flex-col sm:flex-row gap-4"
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="sale" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('buy_now_label')}</FormLabel>
                    </FormItem>
                    {/* Tạm ẩn Đấu giá và Razz
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="auction" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('auction_label')}</FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="razz" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('razz_label')}</FormLabel>
                    </FormItem>
                    */}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ─── Bundle Items ─── */}
          {isBundle && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-500" />
                  <h3 className="text-base font-semibold text-violet-500">{copy.bundleList}</h3>
                  <span className="text-xs text-muted-foreground">({copy.cardsCount.replace('{count}', String(bundleItems.length))})</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addBundleItem}
                  className="gap-1.5 border-violet-500/30 text-violet-500 hover:bg-violet-500/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {copy.addCard}
                </Button>
              </div>

              <div className="space-y-3">
                {bundleItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-violet-500/10 bg-background/50 group animate-in slide-in-from-top-1 duration-150"
                  >
                    <span className="flex items-center justify-center h-8 w-8 rounded-full bg-violet-500/10 text-violet-500 text-sm font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </span>
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                        <Input
                          placeholder={copy.cardItemPlaceholder.replace('{number}', String(index + 1))}
                          value={item.title}
                          onChange={(e) => updateBundleItem(item.id, 'title', e.target.value)}
                          className="text-sm"
                        />
                        <Input
                          type="text"
                          inputMode="numeric"
                          placeholder="Giá (VNĐ)"
                          value={formatNumericInput(item.price)}
                          onChange={(e) => updateBundleItem(item.id, 'price', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      {activeBundleAttrKeys.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {activeBundleAttrKeys.map(key => (
                            <select
                              key={key}
                              value={item.attrs[key] ?? ''}
                              onChange={(e) => updateBundleItemAttr(item.id, key, e.target.value)}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                            >
                              <option value="">{bundleAttrLabels[key]}: {copy.attrAssignPlaceholder}</option>
                              {bundlePools[key].map(v => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBundleItem(item.id)}
                      disabled={bundleItems.length <= 2}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Bundle summary */}
              {bundlePriceRange && (
                <div className="flex items-center justify-between pt-3 border-t border-violet-500/10 text-sm">
                  <span className="text-muted-foreground">{copy.bundleDisplayPrice}</span>
                  <span className="font-semibold text-violet-500">
                    {bundlePriceRange.min === bundlePriceRange.max
                      ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.min)
                      : `${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.min)} — ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.max)}`
                    }
                  </span>
                </div>
              )}
              {bundlePriceRange && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{copy.bundleTotalValue}</span>
                  <span className="font-bold text-green-500">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.total)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Price Fields */}
          {listingType === 'sale' && (
            <FormField
              control={form.control}
              name="price"
              render={() => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>
                    {isBundle ? copy.priceBundlePlaceholder.replace('Nhập ', '').replace(' (VND)', '') : t('price_label')}
                  </FormLabel>

                  {/* Currency toggle — VND is stored either way, USD just gets converted. */}
                  <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-accent/30 p-1 w-fit">
                    {(['VND', 'USD'] as const).map((cur) => (
                      <button
                        key={cur}
                        type="button"
                        onClick={() => { setPriceCurrency(cur); applyPrice(priceInput, cur); }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${priceCurrency === cur ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {cur === 'VND' ? '🇻🇳 VND' : '🇺🇸 USD'}
                      </button>
                    ))}
                  </div>

                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder={priceCurrency === 'USD'
                        ? copy.priceUsdPlaceholder
                        : (isBundle ? copy.priceBundlePlaceholder : copy.priceVndPlaceholder)
                      }
                      value={formattedPriceInput}
                      onChange={(e) => applyPrice(e.target.value, priceCurrency)}
                    />
                  </FormControl>

                  {/* Live conversion preview when pricing in USD. */}
                  {priceCurrency === 'USD' && priceInputNumber > 0 && (
                    <p className="text-sm font-medium text-orange-400">
                      ≈ {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(convertedVnd)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">(1 USD = {new Intl.NumberFormat('vi-VN').format(USD_TO_VND_RATE)}đ)</span>
                    </p>
                  )}

                  {isBundle && bundlePriceRange && (
                    <p className="text-xs text-muted-foreground">
                      💡 Tổng giá từng thẻ: {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.total)} — Bạn có thể đặt giá bán cả bộ thấp hơn hoặc cao hơn
                    </p>
                  )}
                  {priceCurrency === 'USD' && (
                    <p className="text-xs text-muted-foreground">{copy.usdNote}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {listingType === 'auction' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="startingBid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('starting_bid_label')}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder={copy.priceVndPlaceholder}
                        {...field}
                        value={formatNumericInput(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="auctionEnds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('auction_end_date_label')}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {listingType === 'razz' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="ticketPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('ticket_price_label')}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder={copy.priceVndPlaceholder}
                        {...field}
                        value={formatNumericInput(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalTickets"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('total_tickets_label')}</FormLabel>                  <FormControl>
                      <Input type="number" placeholder={copy.quantity} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* ─── Accept Offers ─── */}
          {listingType === 'sale' && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
              <FormField
                control={form.control}
                name="acceptOffers"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <HandCoins className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <FormLabel className="text-base font-semibold cursor-pointer">{copy.acceptOffers}</FormLabel>
                        <p className="text-xs text-muted-foreground mt-0.5">{copy.acceptOffersDesc}</p>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {isBundle && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{copy.bundleOfferNote}</span>
                </div>
              )}

              {acceptOffers && (
                <FormField
                  control={form.control}
                  name="minOfferPercent"
                  render={({ field }) => (
                    <FormItem className="rounded-lg border border-amber-500/10 bg-background/50 p-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-sm font-medium">{copy.minOffer}</FormLabel>
                        <div className="flex items-center gap-1.5">
                          <span className="text-2xl font-bold text-amber-500 tabular-nums">{field.value || 0}</span>
                          <span className="text-sm font-semibold text-muted-foreground">%</span>
                        </div>
                      </div>
                      <FormControl>
                        <Slider
                          min={0}
                          max={99}
                          step={5}
                          defaultValue={[field.value || 0]}
                          onValueChange={(value) => field.onChange(value[0])}
                          className="[&_[role=slider]]:bg-amber-500 [&_[role=slider]]:border-amber-600"
                        />
                      </FormControl>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{copy.acceptAllOffers}</span>
                        <span>{copy.nearOriginalPrice}</span>
                      </div>
                      {watchedPrice && Number(watchedPrice) > 0 && field.value > 0 && (
                        <p className="text-xs text-amber-500/80 border-t border-amber-500/10 pt-3 mt-1">
                          💡 Offer tối thiểu: <span className="font-semibold">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(watchedPrice) * (field.value / 100))}</span>
                          {' '}(từ giá gốc {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(watchedPrice))})
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          )}

          {/* Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>{t('description_label')}</FormLabel>
                <FormControl>
                  <Textarea placeholder={t('description_placeholder')} rows={6} {...field} />
                </FormControl>
                <div className="flex items-center justify-between">
                  <FormMessage />
                  <span className={`ml-auto text-xs ${(field.value?.length || 0) < 300 ? 'text-muted-foreground' : 'text-green-500'}`}>
                    {field.value?.length || 0}/300
                  </span>
                </div>
              </FormItem>
            )}
          />

          {/* Seller payout fee notice — shown right before posting so the seller
              factors the 5% withdrawal fee into their price. */}
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <HandCoins className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-amber-300">{copy.payoutNote}</p>
                <p className="text-muted-foreground">{copy.payoutNoteDesc}</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button size="lg" type="submit" disabled={isSubmitting || isProcessingImages}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create_listing_button')}
            </Button>
          </div>
        </form>

        {/* Confirm the USD → VND conversion before actually posting. */}
        <AlertDialog open={showUsdConfirm} onOpenChange={setShowUsdConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{copy.usdConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>{copy.usdConfirmDesc}</p>
                  <div className="rounded-lg border bg-accent/40 p-3 text-foreground">
                    <p className="text-sm text-muted-foreground">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInputNumber)} ×&nbsp;{new Intl.NumberFormat('vi-VN').format(USD_TO_VND_RATE)}</p>
                    <p className="text-2xl font-bold text-orange-400">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(convertedVnd)}</p>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>{copy.editPrice}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => { setShowUsdConfirm(false); if (pendingValues) void submitListing(pendingValues); }}
                disabled={isSubmitting}
              >
                {copy.confirmPrice}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Form>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('create_listing_title')}</CardTitle>
              <CardDescription>{t('create_listing_description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {renderContent()}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
