import { ORGANIZATION, SITE_DESCRIPTION_EN, SITE_DESCRIPTION_VI, SITE_NAME, SITE_URL, socialProfiles } from '@/lib/seo/site';

/**
 * `llms.txt` — the site described for language-model crawlers, in the format
 * they are taught to look for at the root. Generated from the same entity
 * record as the page metadata and the JSON-LD so the three never disagree.
 */
export const dynamic = 'force-static';
export const revalidate = 86400;

export function GET() {
  const socials = socialProfiles();
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION_VI}

> ${SITE_DESCRIPTION_EN}

Người bán cần xác minh danh tính và tài khoản ngân hàng trước khi đăng bán. Chi tiết thanh toán, giao hàng và xử lý khiếu nại nằm trong các chính sách bên dưới.

## Trang chính

- [Mua thẻ](${SITE_URL}/buy): toàn bộ thẻ đang rao bán.
- [Bán thẻ](${SITE_URL}/sell): đăng bán, phí sàn và quy trình xác minh người bán.
- [Thẻ Pokémon](${SITE_URL}/pokemon): tra giá thị trường hơn 27.000 thẻ Pokémon TCG theo set.
- [Thẻ One Piece](${SITE_URL}/onepiece): tra giá hơn 18.000 thẻ One Piece Card Game.
- [Thẻ bóng đá](${SITE_URL}/soccer): thẻ cầu thủ Topps, Panini, Match Attax.
- [Thẻ đã bán](${SITE_URL}/sold): giá chốt thực tế của các giao dịch đã hoàn tất.
- [Trợ giúp](${SITE_URL}/help): câu hỏi thường gặp về mua, bán, thanh toán, vận chuyển.
- [Giới thiệu](${SITE_URL}/about): về ${SITE_NAME}.

## Chính sách

- [Điều khoản dịch vụ](${SITE_URL}/terms)
- [Chính sách bảo mật](${SITE_URL}/privacy)
- [Cơ chế khiếu nại](${SITE_URL}/complaints)

## Liên hệ

- Email: ${ORGANIZATION.email}
- Điện thoại: ${ORGANIZATION.phone}
- Địa chỉ: ${ORGANIZATION.address.streetAddress}, ${ORGANIZATION.address.addressLocality}, ${ORGANIZATION.address.addressRegion}, Việt Nam
${socials.map((url) => `- ${url}`).join('\n')}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
