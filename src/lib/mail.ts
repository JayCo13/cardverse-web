// Transport lives in mail-transport.ts: Resend when RESEND_API_KEY is set,
// SMTP otherwise. Re-exported so existing importers keep working.
export { createMailTransporter, getFromAddress } from './mail-transport';
import { createMailTransporter, getFromAddress } from './mail-transport';
import { translations, type TranslationKey } from './i18n';
import type { SupportedLocale } from './request-localization';

function getAppUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://cardversehub.com';
}

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function mailText(
    locale: SupportedLocale,
    key: TranslationKey,
    variables?: Record<string, string>,
) {
    let value = translations[locale][key] || translations['en-US'][key] || key;
    for (const [name, replacement] of Object.entries(variables || {})) {
        value = value.replaceAll(`{${name}}`, replacement);
    }
    return value;
}

function buildTemplate(title: string, body: string, locale: SupportedLocale = 'vi-VN') {
    const appUrl = getAppUrl();
    const logoUrl = `${appUrl}/assets/logo-verse.png`;
    const year = new Date().getFullYear();
    const language = locale === 'ja-JP' ? 'ja' : locale === 'en-US' ? 'en' : 'vi';

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <title>CardVerseHub</title>
</head>
<body style="margin: 0; padding: 0; background-color: #08080a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <!-- Preheader (hidden) -->
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${title}</div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #08080a;">
        <tr>
            <td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px; background-color: #131316; border-radius: 20px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.6);">
                    <!-- Header with centered logo -->
                    <tr>
                        <td align="center" style="padding: 40px 40px 32px; background: linear-gradient(135deg, rgba(249,115,22,0.18) 0%, rgba(249,115,22,0.03) 55%, transparent 100%);">
                            <img src="${logoUrl}" alt="CardVerseHub" height="40" style="display: block; height: 40px; width: auto; border: 0; outline: none; text-decoration: none;">
                        </td>
                    </tr>
                    <!-- Accent divider -->
                    <tr>
                        <td style="height: 3px; line-height: 3px; font-size: 0; background: linear-gradient(90deg, transparent, #f97316 50%, transparent);">&nbsp;</td>
                    </tr>
                    <!-- Title -->
                    <tr>
                        <td style="padding: 36px 40px 12px;">
                            <h2 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.4px; line-height: 1.35;">${title}</h2>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 0 40px 36px;">
                            <div style="color: #b4b4bd; font-size: 15px; line-height: 1.75;">
                                ${body}
                            </div>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 28px 40px; background-color: rgba(0,0,0,0.35); border-top: 1px solid rgba(255,255,255,0.06);">
                            <p style="margin: 0 0 6px; color: #71717a; font-size: 13px; text-align: center; font-weight: 600;">CardVerseHub — ${mailText(locale, 'email_brand_description')}</p>
                            <p style="margin: 0; color: #52525b; font-size: 12px; text-align: center; line-height: 1.6;">
                                <a href="${appUrl}" style="color: #f97316; text-decoration: none;">${appUrl.replace(/^https?:\/\//, '')}</a>
                                &nbsp;&middot;&nbsp; &copy; ${year} CardVerseHub. ${mailText(locale, 'email_all_rights_reserved')}
                            </p>
                        </td>
                    </tr>
                </table>
                <!-- Sub-footer note -->
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px;">
                    <tr>
                        <td style="padding: 16px 40px 0; text-align: center;">
                            <p style="margin: 0; color: #3f3f46; font-size: 11px; line-height: 1.6;">${mailText(locale, 'email_automated_notice')}</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function sendKYCIdentityApproved(
    userEmail: string,
    fullName: string,
    locale: SupportedLocale,
): Promise<boolean> {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const safeName = escapeHtml(fullName);
        const appUrl = getAppUrl();

        await transporter.sendMail({
            from,
            to: userEmail,
            subject: mailText(locale, 'email_kyc_identity_subject'),
            html: buildTemplate(
                mailText(locale, 'email_kyc_identity_title'),
                `<p style="color: #e4e4e7;">${mailText(locale, 'email_kyc_identity_greeting', { fullName: safeName })}</p>
                <p>${mailText(locale, 'email_kyc_identity_body')}</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #fb923c;">${mailText(locale, 'email_kyc_identity_next_step')}</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${appUrl}/sell" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">${mailText(locale, 'email_kyc_identity_cta')} →</a>
                </div>`,
                locale,
            ),
        });
        console.log(`[Mail] KYC identity-complete notification sent to ${userEmail}`);
        return true;
    } catch (error) {
        console.error('[Mail] Failed to send KYC identity-complete email:', error);
        return false;
    }
}

export async function sendKYCSubmittedToUser(
    userEmail: string,
    fullName: string,
    locale: SupportedLocale = 'vi-VN',
) {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const safeName = escapeHtml(fullName);

        await transporter.sendMail({
            from,
            to: userEmail,
            subject: mailText(locale, 'email_kyc_submitted_subject'),
            html: buildTemplate(
                mailText(locale, 'email_kyc_submitted_title'),
                `<p style="color: #e4e4e7;">${mailText(locale, 'email_kyc_submitted_greeting', { fullName: safeName })}</p>
                <p>${mailText(locale, 'email_kyc_submitted_body')}</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #fb923c;">${mailText(locale, 'email_kyc_submitted_status')}</p>
                </div>
                <p>${mailText(locale, 'email_kyc_submitted_next_step')}</p>`,
                locale,
            ),
        });
        console.log(`[Mail] KYC submitted notification sent to ${userEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send KYC submitted email:', error);
    }
}

export async function sendOrderShippedEmail(
    buyerEmail: string,
    params: { cardName: string; carrierName: string; trackingNumber: string; trackingUrl: string | null },
) {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const appUrl = getAppUrl();
        const { cardName, carrierName, trackingNumber, trackingUrl } = params;

        const trackingBlock = trackingUrl
            ? `<a href="${trackingUrl}" target="_blank" style="display:inline-block; margin-top:10px; background:#f97316; color:#fff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:10px; font-size:14px;">Theo dõi đơn: ${trackingNumber}</a>`
            : `<p style="margin:8px 0 0; color:#e4e4e7; font-weight:700; font-size:16px;">${trackingNumber}</p>`;

        await transporter.sendMail({
            from,
            to: buyerEmail,
            subject: '📦 Đơn hàng của bạn đã được gửi — CardVerseHub',
            html: buildTemplate(
                '📦 Đơn hàng đã được gửi',
                `<p style="color:#e4e4e7;">Người bán đã gửi thẻ <strong style="color:#f97316;">${cardName}</strong> cho bạn.</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Đơn vị vận chuyển</p>
                    <p style="margin:2px 0 12px; color:#fff; font-weight:700;">${carrierName}</p>
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Mã vận đơn</p>
                    ${trackingBlock}
                </div>
                <p>Bạn có thể nhấn nút trên để theo dõi hành trình đơn hàng, hoặc xem chi tiết tại <a href="${appUrl}/orders" style="color:#f97316; text-decoration:none;">Đơn hàng của tôi</a>.</p>
                <p style="color:#71717a; font-size:13px; margin-top:24px;">Khi nhận được thẻ, đừng quên bấm "Đã nhận hàng" để hoàn tất giao dịch nhé!</p>`
            ),
        });
        console.log(`[Mail] Order shipped notification sent to ${buyerEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send order shipped email:', error);
    }
}

export async function sendKYCSubmittedToAdmin(fullName: string, userEmail: string, adminEmails: string[]) {
    try {
        if (!adminEmails || adminEmails.length === 0) return;

        const transporter = createMailTransporter();
        const from = getFromAddress();

        await transporter.sendMail({
            from,
            to: from,
            bcc: adminEmails,
            subject: `🔔 KYC mới cần duyệt: ${fullName}`,
            html: buildTemplate(
                '🔔 Hồ sơ KYC mới cần duyệt',
                `<p style="color: #e4e4e7;">Có một hồ sơ xác minh người bán mới cần được duyệt:</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #fb923c;">👤 <strong>Người gửi:</strong> ${fullName}</p>
                    <p style="margin: 8px 0 0; color: #a1a1aa;">📧 <strong>Email:</strong> ${userEmail}</p>
                </div>
                <p>Vào trang <strong style="color: #f97316;">Admin Dashboard → KYC Sellers</strong> để xem chi tiết và duyệt hồ sơ.</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001'}/kyc" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Duyệt hồ sơ →</a>
                </div>`
            ),
        });
        console.log(`[Mail] KYC admin notification sent to ${adminEmails.length} admin(s)`);
    } catch (error) {
        console.error('[Mail] Failed to send KYC admin email:', error);
    }
}

/**
 * Tell the review team a session is waiting on a human at the provider.
 *
 * The decision is made in Didit's console, not ours: 'In Review' means its
 * automation would not rule either way, and the case sits there until someone
 * approves or declines it. So this points at the console and carries the
 * session id needed to find the case, plus the provider's own warnings — those
 * are the reason it stopped, and reading them first is what makes the review
 * short.
 *
 * Returns whether the mail was handed to the transport, so the caller can keep
 * its delivery claim honest.
 */
export async function sendKycManualReviewToAdmin(input: {
    fullName: string | null;
    userEmail: string | null;
    providerSessionId: string;
    warnings: string[];
    adminEmails: string[];
}): Promise<boolean> {
    try {
        if (!input.adminEmails || input.adminEmails.length === 0) {
            console.warn('[Mail] KYC manual-review alert has no recipients');
            return false;
        }

        const transporter = createMailTransporter();
        const from = getFromAddress();
        const consoleUrl = process.env.DIDIT_CONSOLE_URL || 'https://business.didit.me/console';
        const name = escapeHtml(input.fullName || 'Không đọc được tên');

        const warningRows = input.warnings.length > 0
            ? input.warnings
                .map((warning) => `<li style="margin: 4px 0; color: #fcd34d;">${escapeHtml(warning)}</li>`)
                .join('')
            : '<li style="margin: 4px 0; color: #a1a1aa;">Nhà cung cấp không nêu cảnh báo cụ thể.</li>';

        await transporter.sendMail({
            from,
            to: from,
            bcc: input.adminEmails,
            subject: `⏳ KYC chờ duyệt thủ công: ${input.fullName || input.providerSessionId}`,
            html: buildTemplate(
                '⏳ Hồ sơ KYC cần người duyệt tay',
                `<p style="color: #e4e4e7;">Didit đã chuyển một phiên xác minh sang trạng thái <strong>In Review</strong> — hệ thống tự động không kết luận được, cần người vào xem và quyết định.</p>
                <div style="background: rgba(250,204,21,0.1); border: 1px solid rgba(250,204,21,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #fcd34d;">👤 <strong>Tên trên giấy tờ:</strong> ${name}</p>
                    <p style="margin: 8px 0 0; color: #a1a1aa;">📧 <strong>Tài khoản:</strong> ${escapeHtml(input.userEmail || 'không rõ')}</p>
                    <p style="margin: 8px 0 0; color: #a1a1aa;">🔖 <strong>Session ID:</strong> <code style="color:#e4e4e7;">${escapeHtml(input.providerSessionId)}</code></p>
                </div>
                <p style="color: #e4e4e7; margin-bottom: 8px;"><strong>Cảnh báo từ nhà cung cấp:</strong></p>
                <ul style="margin: 0 0 20px; padding-left: 20px;">${warningRows}</ul>
                <p style="color: #a1a1aa;">Mở Didit Business Console, tìm phiên theo Session ID ở trên, rồi chọn Approve / Decline / Request Resubmission. Kết quả sẽ tự đồng bộ về CardVerseHub qua webhook — không cần thao tác gì thêm ở admin dashboard.</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${consoleUrl}" style="display: inline-block; background: #eab308; color: #000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Mở Didit Console →</a>
                </div>`
            ),
        });

        console.log(`[Mail] KYC manual-review alert sent to ${input.adminEmails.length} recipient(s)`);
        return true;
    } catch (error) {
        console.error('[Mail] Failed to send KYC manual-review alert:', error);
        return false;
    }
}

/**
 * Tell a buyer their accepted offer is about to lose its card.
 *
 * Sent once, four hours before the window closes, and the penalty for missing
 * the deadline only applies to buyers who got this — a deadline nobody was told
 * about is not one they knowingly missed.
 */
export async function sendOfferPaymentReminder(input: {
    to: string;
    cardName: string;
    offerId: string;
    price: number;
    deadline: string | null;
}): Promise<boolean> {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const appUrl = getAppUrl();
        const amount = `${new Intl.NumberFormat('vi-VN').format(Math.round(input.price))}đ`;
        const closes = input.deadline
            ? new Date(input.deadline).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : null;

        await transporter.sendMail({
            from,
            to: input.to,
            subject: `⏰ Sắp hết hạn thanh toán: ${input.cardName || 'thẻ bạn đã trả giá'}`,
            html: buildTemplate(
                '⏰ Thẻ của bạn sắp được trả lại chợ',
                `<p style="color:#e4e4e7;">Người bán đã chấp nhận lời trả giá của bạn và đang giữ thẻ này. Nếu chưa thanh toán trước hạn, thẻ sẽ được đăng bán lại và điểm uy tín của bạn bị trừ.</p>
                <div style="background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.2);border-radius:8px;padding:16px;margin:20px 0;">
                    <p style="margin:0;color:#fb923c;">🃏 <strong>Thẻ:</strong> ${escapeHtml(input.cardName || '')}</p>
                    <p style="margin:8px 0 0;color:#e4e4e7;">💰 <strong>Số tiền:</strong> ${amount}</p>
                    ${closes ? `<p style="margin:8px 0 0;color:#a1a1aa;">⏳ <strong>Hạn thanh toán:</strong> ${closes}</p>` : ''}
                </div>
                <div style="text-align:center;margin:24px 0;">
                    <a href="${appUrl}/checkout?offerId=${encodeURIComponent(input.offerId)}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Thanh toán ngay →</a>
                </div>`
            ),
        });
        return true;
    } catch (error) {
        console.error('[Mail] Failed to send offer payment reminder:', error);
        return false;
    }
}

export async function sendWithdrawalSubmittedToAdmin(input: {
    sellerName: string;
    sellerEmail: string;
    amountRequested: number;
    fee: number;
    amountNet: number;
    bankName: string;
    bankAccountNumber: string;
    adminEmails: string[];
}) {
    try {
        if (input.adminEmails.length === 0) {
            console.warn('[Mail] No admin recipients configured for withdrawal notification');
            return;
        }

        const transporter = createMailTransporter();
        const from = getFromAddress();
        const formatVND = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
        const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';

        await transporter.sendMail({
            from,
            to: from,
            bcc: input.adminEmails,
            subject: `💸 Yêu cầu rút tiền mới: ${formatVND(input.amountRequested)} — ${input.sellerName}`,
            html: buildTemplate(
                '💸 Yêu cầu rút tiền mới cần xử lý',
                `<p style="color:#e4e4e7;">Seller vừa gửi một yêu cầu rút tiền đang chờ admin chuyển khoản:</p>
                <div style="background:rgba(249,115,22,0.1); border:1px solid rgba(249,115,22,0.2); border-radius:8px; padding:16px; margin:20px 0;">
                    <p style="margin:0 0 8px; color:#fb923c;"><strong>Seller:</strong> ${input.sellerName} (${input.sellerEmail})</p>
                    <p style="margin:0 0 8px; color:#e4e4e7;"><strong>Yêu cầu:</strong> ${formatVND(input.amountRequested)}</p>
                    <p style="margin:0 0 8px; color:#a1a1aa;"><strong>Phí nền tảng:</strong> ${formatVND(input.fee)}</p>
                    <p style="margin:0 0 8px; color:#4ade80;"><strong>Thực chuyển:</strong> ${formatVND(input.amountNet)}</p>
                    <p style="margin:0; color:#a1a1aa;"><strong>Tài khoản:</strong> ${input.bankName} ••••${input.bankAccountNumber.slice(-4)}</p>
                </div>
                <p>Số tiền hiện đang được tạm giữ và chưa được ghi nhận là đã rút.</p>
                <div style="text-align:center; margin:24px 0;">
                    <a href="${adminUrl}/withdrawals" style="display:inline-block; background:#f97316; color:#fff; padding:12px 32px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px;">Xử lý yêu cầu →</a>
                </div>`,
            ),
        });
        console.log(`[Mail] Withdrawal notification sent to ${input.adminEmails.length} admin(s)`);
    } catch (error) {
        console.error('[Mail] Failed to send withdrawal admin email:', error);
    }
}

export async function sendKYCApproved(
    userEmail: string,
    fullName: string,
    locale: SupportedLocale = 'vi-VN',
) {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const safeName = escapeHtml(fullName);
        const appUrl = getAppUrl();

        await transporter.sendMail({
            from,
            to: userEmail,
            subject: mailText(locale, 'email_kyc_approved_subject'),
            html: buildTemplate(
                mailText(locale, 'email_kyc_approved_title'),
                `<p style="color: #e4e4e7;">${mailText(locale, 'email_kyc_approved_greeting', { fullName: safeName })}</p>
                <p>${mailText(locale, 'email_kyc_approved_body')}</p>
                <div style="background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #4ade80;">${mailText(locale, 'email_kyc_approved_status')}</p>
                    <p style="margin: 8px 0 0; color: #a1a1aa; font-size: 13px;">${mailText(locale, 'email_kyc_approved_next_step')}</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${appUrl}/sell" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">${mailText(locale, 'email_kyc_approved_cta')} →</a>
                </div>`,
                locale,
            ),
        });
        console.log(`[Mail] KYC approved notification sent to ${userEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send KYC approved email:', error);
    }
}

export async function sendKYCRejected(userEmail: string, fullName: string, reason: string) {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();

        await transporter.sendMail({
            from,
            to: userEmail,
            subject: '❌ Hồ sơ KYC chưa được duyệt — CardVerseHub',
            html: buildTemplate(
                '❌ Hồ sơ chưa được duyệt',
                `<p style="color: #e4e4e7;">Xin chào <strong style="color: #f97316;">${fullName}</strong>,</p>
                <p>Hồ sơ xác minh người bán của bạn chưa đạt yêu cầu. Vui lòng xem lý do bên dưới:</p>
                <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #f87171;">❌ <strong>Lý do từ chối:</strong></p>
                    <p style="margin: 8px 0 0; color: #fca5a5;">${reason}</p>
                </div>
                <p>Bạn có thể chỉnh sửa thông tin và gửi lại hồ sơ bất kỳ lúc nào.</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/sell" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Gửi lại hồ sơ →</a>
                </div>
                <p style="color: #71717a; font-size: 13px;">Nếu có thắc mắc, vui lòng liên hệ hỗ trợ.</p>`
            ),
        });
        console.log(`[Mail] KYC rejected notification sent to ${userEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send KYC rejected email:', error);
    }
}

// ─── Order placed ────────────────────────────────────────────────────────────
//
// Sent the moment payment is confirmed: immediately for wallet checkouts, and
// from the PayOS webhook for bank transfers — never when the payment link is
// merely created, or a buyer who abandoned the QR would get a receipt for an
// order they never paid for.

const formatVnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(amount))}đ`;

/** Short, human-quotable order reference. Matches what the orders page shows. */
const shortOrderId = (orderId: string) => orderId.slice(0, 8).toUpperCase();

export async function sendOrderPlacedToBuyer(
    buyerEmail: string,
    params: {
        orderId: string;
        cardName: string;
        amount: number;
        shippingFee: number;
        totalPaid: number;
        carrierName?: string | null;
        shippingAddress?: string | null;
    },
) {
    try {
        if (!buyerEmail) return;
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const appUrl = getAppUrl();

        await transporter.sendMail({
            from,
            to: buyerEmail,
            subject: `✅ Đặt hàng thành công #${shortOrderId(params.orderId)} — CardVerseHub`,
            html: buildTemplate(
                '✅ Đặt hàng thành công',
                `<p style="color:#e4e4e7;">Cảm ơn bạn đã mua hàng trên CardVerseHub. Đơn hàng của bạn đã được thanh toán và đang chờ người bán gửi đi.</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Mã đơn hàng</p>
                    <p style="margin:2px 0 12px; color:#fff; font-weight:700;">#${shortOrderId(params.orderId)}</p>
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Sản phẩm</p>
                    <p style="margin:2px 0 12px; color:#fff; font-weight:700;">${params.cardName}</p>
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        <tr><td style="color:#a1a1aa; padding:2px 0;">Giá thẻ</td><td align="right" style="color:#e4e4e7;">${formatVnd(params.amount)}</td></tr>
                        <tr><td style="color:#a1a1aa; padding:2px 0;">Phí vận chuyển</td><td align="right" style="color:#e4e4e7;">${formatVnd(params.shippingFee)}</td></tr>
                        <tr><td style="color:#fff; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">Tổng thanh toán</td><td align="right" style="color:#f97316; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">${formatVnd(params.totalPaid)}</td></tr>
                    </table>
                </div>
                ${params.carrierName ? `<p style="color:#a1a1aa; font-size:13px; margin:0;">Đơn vị vận chuyển: <strong style="color:#e4e4e7;">${params.carrierName}</strong></p>` : ''}
                ${params.shippingAddress ? `<p style="color:#a1a1aa; font-size:13px; margin:4px 0 0;">Giao đến: <strong style="color:#e4e4e7;">${params.shippingAddress}</strong></p>` : ''}
                <p style="margin-top:20px;">Chúng tôi sẽ báo bạn ngay khi người bán gửi hàng. Xem chi tiết tại <a href="${appUrl}/orders" style="color:#f97316; text-decoration:none;">Đơn hàng của tôi</a>.</p>
                <p style="color:#71717a; font-size:13px; margin-top:24px;">Tiền của bạn được CardVerseHub giữ cho đến khi bạn xác nhận đã nhận thẻ.</p>`,
            ),
        });
        console.log(`[Mail] Order placed notification sent to buyer ${buyerEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send order placed email to buyer:', error);
    }
}

export async function sendOrderPlacedToSeller(
    sellerEmail: string,
    params: {
        orderId: string;
        cardName: string;
        amount: number;
        platformFee?: number | null;
        buyerName?: string | null;
        shippingAddress?: string | null;
    },
) {
    try {
        if (!sellerEmail) return;
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const appUrl = getAppUrl();

        // Only show a net figure when the platform fee is actually known, so a
        // seller is never quoted a payout that later turns out to be different.
        const netRow =
            typeof params.platformFee === 'number'
                ? `<tr><td style="color:#a1a1aa; padding:2px 0;">Phí nền tảng</td><td align="right" style="color:#e4e4e7;">-${formatVnd(params.platformFee)}</td></tr>
                   <tr><td style="color:#fff; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">Bạn nhận được</td><td align="right" style="color:#f97316; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">${formatVnd(params.amount - params.platformFee)}</td></tr>`
                : '';

        await transporter.sendMail({
            from,
            to: sellerEmail,
            subject: `🛒 Bạn có đơn hàng mới #${shortOrderId(params.orderId)} — CardVerseHub`,
            html: buildTemplate(
                '🛒 Bạn có đơn hàng mới',
                `<p style="color:#e4e4e7;">Người mua đã thanh toán. Vui lòng chuẩn bị và gửi hàng sớm nhất có thể.</p>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Mã đơn hàng</p>
                    <p style="margin:2px 0 12px; color:#fff; font-weight:700;">#${shortOrderId(params.orderId)}</p>
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">Sản phẩm</p>
                    <p style="margin:2px 0 12px; color:#fff; font-weight:700;">${params.cardName}</p>
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        <tr><td style="color:#a1a1aa; padding:2px 0;">Giá bán</td><td align="right" style="color:#e4e4e7;">${formatVnd(params.amount)}</td></tr>
                        ${netRow}
                    </table>
                </div>
                ${params.buyerName ? `<p style="color:#a1a1aa; font-size:13px; margin:0;">Người mua: <strong style="color:#e4e4e7;">${params.buyerName}</strong></p>` : ''}
                ${params.shippingAddress ? `<p style="color:#a1a1aa; font-size:13px; margin:4px 0 0;">Giao đến: <strong style="color:#e4e4e7;">${params.shippingAddress}</strong></p>` : ''}
                <p style="margin-top:20px;">Vào <a href="${appUrl}/orders?tab=seller" style="color:#f97316; text-decoration:none;">Đơn bán của tôi</a> để nhập mã vận đơn sau khi gửi.</p>
                <p style="color:#71717a; font-size:13px; margin-top:24px;">Tiền sẽ về ví của bạn sau khi người mua xác nhận đã nhận thẻ.</p>`,
            ),
        });
        console.log(`[Mail] Order placed notification sent to seller ${sellerEmail}`);
    } catch (error) {
        console.error('[Mail] Failed to send order placed email to seller:', error);
    }
}

type ContactRequestEmail = {
    name: string;
    email: string;
    subject: string;
    message: string;
};

export async function sendContactSubmissionConfirmation(
    recipient: string,
    contact: ContactRequestEmail,
    locale: SupportedLocale,
) {
    try {
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const safeName = escapeHtml(contact.name);
        const safeSubject = escapeHtml(contact.subject);
        const copy = locale === 'vi-VN'
            ? {
                subject: 'Chúng tôi đã nhận được liên hệ của bạn — CardVerseHub',
                title: 'Đã nhận được yêu cầu liên hệ',
                body: 'Cảm ơn bạn đã liên hệ với CardVerseHub. Đội ngũ hỗ trợ sẽ xem xét và phản hồi qua email trong thời gian sớm nhất.',
                reference: 'Chủ đề của bạn',
            }
            : locale === 'ja-JP'
                ? {
                    subject: 'お問い合わせを受け付けました — CardVerseHub',
                    title: 'お問い合わせを受け付けました',
                    body: 'CardVerseHub にお問い合わせいただきありがとうございます。サポートチームが確認後、できるだけ早くメールでご連絡します。',
                    reference: 'お問い合わせの件名',
                }
                : {
                    subject: 'We received your contact request — CardVerseHub',
                    title: 'Contact request received',
                    body: 'Thank you for contacting CardVerseHub. Our support team will review your request and reply by email as soon as possible.',
                    reference: 'Your subject',
                };

        await transporter.sendMail({
            from,
            to: recipient,
            subject: copy.subject,
            html: buildTemplate(
                copy.title,
                `<p style="color:#e4e4e7;">${locale === 'vi-VN' ? 'Xin chào' : locale === 'ja-JP' ? 'こんにちは' : 'Hello'} <strong style="color:#f97316;">${safeName}</strong>,</p>
                <p>${copy.body}</p>
                <div style="background:rgba(249,115,22,0.1); border:1px solid rgba(249,115,22,0.2); border-radius:8px; padding:16px; margin:20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">${copy.reference}</p>
                    <p style="margin:4px 0 0; color:#fff; font-weight:700;">${safeSubject}</p>
                </div>`,
                locale,
            ),
        });
    } catch (error) {
        console.error('[Mail] Failed to send contact confirmation:', error);
    }
}

export async function sendContactSubmittedToAdmin(contact: ContactRequestEmail, recipients: string[]) {
    try {
        if (recipients.length === 0) return;
        const transporter = createMailTransporter();
        const from = getFromAddress();
        const safeName = escapeHtml(contact.name);
        const safeEmail = escapeHtml(contact.email);
        const safeSubject = escapeHtml(contact.subject);
        const safeMessage = escapeHtml(contact.message).replaceAll('\n', '<br>');

        await transporter.sendMail({
            from,
            bcc: recipients,
            subject: `✉️ Liên hệ mới: ${contact.subject}`,
            html: buildTemplate(
                '✉️ Có yêu cầu liên hệ mới',
                `<p style="color:#e4e4e7;">Một người dùng vừa gửi liên hệ từ website.</p>
                <div style="background:rgba(249,115,22,0.1); border:1px solid rgba(249,115,22,0.2); border-radius:8px; padding:16px; margin:20px 0;">
                    <p style="margin:0 0 8px; color:#a1a1aa;">Người gửi: <strong style="color:#fff;">${safeName}</strong></p>
                    <p style="margin:0 0 8px; color:#a1a1aa;">Email: <strong style="color:#fff;">${safeEmail}</strong></p>
                    <p style="margin:0; color:#a1a1aa;">Chủ đề: <strong style="color:#fff;">${safeSubject}</strong></p>
                </div>
                <p style="color:#a1a1aa; font-size:13px; margin-bottom:6px;">Nội dung</p>
                <p style="margin:0; color:#e4e4e7; white-space:normal;">${safeMessage}</p>`,
                'vi-VN',
            ),
        });
    } catch (error) {
        console.error('[Mail] Failed to send new-contact alert:', error);
    }
}

type OfferEmailParams = {
    recipientName: string;
    cardName: string;
    offerPrice: number;
    cardId: string;
};

export async function sendOfferReceivedEmail(
    sellerEmail: string,
    params: OfferEmailParams & { listingPrice: number },
    locale: SupportedLocale,
): Promise<boolean> {
    try {
        if (!sellerEmail) return false;
        const transporter = createMailTransporter();
        const appUrl = getAppUrl();
        const safeName = escapeHtml(params.recipientName);
        const safeCardName = escapeHtml(params.cardName);
        const subjectCardName = params.cardName.replace(/[\r\n]+/g, ' ').trim();
        const offerUrl = `${appUrl}/offers?view=received&cardId=${encodeURIComponent(params.cardId)}`;

        await transporter.sendMail({
            from: getFromAddress(),
            to: sellerEmail,
            subject: mailText(locale, 'email_offer_received_subject', { cardName: subjectCardName }),
            html: buildTemplate(
                mailText(locale, 'email_offer_received_title'),
                `<p style="color:#e4e4e7;">${mailText(locale, 'email_offer_received_greeting', { name: safeName })}</p>
                <p>${mailText(locale, 'email_offer_received_body')}</p>
                <div style="background:rgba(249,115,22,0.1); border:1px solid rgba(249,115,22,0.2); border-radius:8px; padding:16px; margin:20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">${mailText(locale, 'email_offer_received_card')}</p>
                    <p style="margin:3px 0 14px; color:#fff; font-weight:700;">${safeCardName}</p>
                    <table role="presentation" style="width:100%; border-collapse:collapse; font-size:14px;">
                        <tr><td style="color:#a1a1aa; padding:3px 0;">${mailText(locale, 'email_offer_received_listing')}</td><td align="right" style="color:#e4e4e7;">${formatVnd(params.listingPrice)}</td></tr>
                        <tr><td style="color:#fff; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">${mailText(locale, 'email_offer_received_offer')}</td><td align="right" style="color:#f97316; font-weight:700; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">${formatVnd(params.offerPrice)}</td></tr>
                    </table>
                </div>
                <div style="text-align:center; margin:24px 0;">
                    <a href="${offerUrl}" style="display:inline-block; background:#f97316; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">${mailText(locale, 'email_offer_received_cta')} →</a>
                </div>
                <p style="color:#71717a; font-size:13px;">${mailText(locale, 'email_offer_received_note')}</p>`,
                locale,
            ),
        });
        console.log(`[Mail] New offer notification sent to seller ${sellerEmail}`);
        return true;
    } catch (error) {
        console.error('[Mail] Failed to send new offer email to seller:', error);
        return false;
    }
}

export async function sendOfferAcceptedEmail(
    buyerEmail: string,
    params: OfferEmailParams & { offerId: string },
    locale: SupportedLocale,
): Promise<boolean> {
    try {
        if (!buyerEmail) return false;
        const transporter = createMailTransporter();
        const appUrl = getAppUrl();
        const safeName = escapeHtml(params.recipientName);
        const safeCardName = escapeHtml(params.cardName);
        const subjectCardName = params.cardName.replace(/[\r\n]+/g, ' ').trim();
        const checkoutUrl = `${appUrl}/checkout?offerId=${encodeURIComponent(params.offerId)}`;

        await transporter.sendMail({
            from: getFromAddress(),
            to: buyerEmail,
            subject: mailText(locale, 'email_offer_accepted_subject', { cardName: subjectCardName }),
            html: buildTemplate(
                mailText(locale, 'email_offer_accepted_title'),
                `<p style="color:#e4e4e7;">${mailText(locale, 'email_offer_accepted_greeting', { name: safeName })}</p>
                <p>${mailText(locale, 'email_offer_accepted_body')}</p>
                <div style="background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.25); border-radius:8px; padding:16px; margin:20px 0;">
                    <p style="margin:0; color:#a1a1aa; font-size:13px;">${mailText(locale, 'email_offer_accepted_card')}</p>
                    <p style="margin:3px 0 14px; color:#fff; font-weight:700;">${safeCardName}</p>
                    <table role="presentation" style="width:100%; border-collapse:collapse; font-size:14px;">
                        <tr><td style="color:#fff; font-weight:700;">${mailText(locale, 'email_offer_accepted_price')}</td><td align="right" style="color:#4ade80; font-weight:700;">${formatVnd(params.offerPrice)}</td></tr>
                    </table>
                </div>
                <div style="text-align:center; margin:24px 0;">
                    <a href="${checkoutUrl}" style="display:inline-block; background:#f97316; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">${mailText(locale, 'email_offer_accepted_cta')} →</a>
                </div>
                <p style="color:#71717a; font-size:13px;">${mailText(locale, 'email_offer_accepted_note')}</p>`,
                locale,
            ),
        });
        console.log(`[Mail] Accepted offer notification sent to buyer ${buyerEmail}`);
        return true;
    } catch (error) {
        console.error('[Mail] Failed to send accepted offer email to buyer:', error);
        return false;
    }
}
