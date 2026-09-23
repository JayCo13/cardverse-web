import Link from 'next/link';

/**
 * A short, server-rendered answer block under each catalogue page, so a
 * search for "mua thẻ Pokémon ở đâu" or "giá thẻ One Piece" finds a direct
 * answer in the HTML rather than a grid that only fills in after the
 * JavaScript runs. Placed after the grid: the page's own header and filters
 * keep the top of the screen.
 */
export type CategoryAnswer = {
  heading: string;
  paragraphs: string[];
  links: { href: string; label: string }[];
};

export const CATEGORY_ANSWERS: Record<'pokemon' | 'onepiece' | 'soccer', CategoryAnswer> = {
  pokemon: {
    heading: 'Mua và tra giá thẻ Pokémon tại Việt Nam',
    paragraphs: [
      'CardVerseHub liệt kê giá thị trường của hơn 27.000 thẻ Pokémon TCG tiếng Anh và tiếng Nhật, cập nhật theo dữ liệu TCGplayer, lọc được theo set, độ hiếm và khoảng giá. Các thẻ đang rao bán tại Việt Nam nằm ở trang Mua thẻ, từ người bán đã xác minh danh tính.',
      'Khi mua, tiền được giữ ký quỹ trong thời gian giao và kiểm tra hàng; phí vận chuyển được báo trước khi thanh toán. Bạn có thể trả giá trực tiếp với người bán trên từng thẻ.',
    ],
    links: [
      { href: '/buy', label: 'Thẻ Pokémon đang bán' },
      { href: '/sell', label: 'Bán thẻ Pokémon của bạn' },
      { href: '/help', label: 'Câu hỏi thường gặp' },
    ],
  },
  onepiece: {
    heading: 'Mua và tra giá thẻ One Piece tại Việt Nam',
    paragraphs: [
      'CardVerseHub liệt kê giá thị trường của hơn 18.000 thẻ One Piece Card Game theo set (OP-01 trở đi), độ hiếm và khoảng giá, cập nhật theo dữ liệu TCGplayer. Các thẻ đang rao bán tại Việt Nam nằm ở trang Mua thẻ, từ người bán đã xác minh danh tính.',
      'Khi mua, tiền được giữ ký quỹ trong thời gian giao và kiểm tra hàng; phí vận chuyển được báo trước khi thanh toán. Bạn có thể trả giá trực tiếp với người bán trên từng thẻ.',
    ],
    links: [
      { href: '/buy', label: 'Thẻ One Piece đang bán' },
      { href: '/sell', label: 'Bán thẻ One Piece của bạn' },
      { href: '/help', label: 'Câu hỏi thường gặp' },
    ],
  },
  soccer: {
    heading: 'Mua bán thẻ cầu thủ bóng đá tại Việt Nam',
    paragraphs: [
      'CardVerseHub là nơi người sưu tầm tại Việt Nam mua bán thẻ cầu thủ bóng đá Topps, Panini và Match Attax — từ thẻ cơ bản tới refractor, auto và thẻ đánh số. Người bán phải xác minh danh tính trước khi đăng bán.',
      'Tiền mua được giữ ký quỹ trong thời gian giao và kiểm tra hàng; phí vận chuyển được báo trước khi thanh toán. Trang Thẻ đã bán ghi lại giá chốt thực tế để bạn tham khảo trước khi mua hoặc định giá.',
    ],
    links: [
      { href: '/buy', label: 'Thẻ bóng đá đang bán' },
      { href: '/sold', label: 'Giá thẻ đã bán' },
      { href: '/sell', label: 'Bán thẻ bóng đá của bạn' },
    ],
  },
};

export function CategoryAnswerSection({ answer }: { answer: CategoryAnswer }) {
  return (
    <section aria-labelledby="category-answer" className="container mx-auto max-w-7xl px-4 pb-12 pt-4">
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 sm:p-8">
        <h2 id="category-answer" className="mb-3 text-lg font-semibold sm:text-xl">{answer.heading}</h2>
        <div className="space-y-3 text-sm leading-6 text-white/60 sm:text-[15px]">
          {answer.paragraphs.map((text) => <p key={text}>{text}</p>)}
        </div>
        <nav aria-label="Liên kết liên quan" className="mt-5 flex flex-wrap gap-2 text-sm">
          {answer.links.map((link) => (
            <Link key={link.href + link.label} href={link.href} className="rounded-full border border-white/10 px-3 py-1.5 text-white/80 transition-colors hover:border-primary hover:text-primary">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
