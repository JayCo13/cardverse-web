import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const MIN_MARKETPLACE_PRICE_VND = 1000;

export async function POST(request: NextRequest) {
    try {
        const authClient = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: verification, error: verificationError } = await authClient
            .from('seller_verifications')
            .select('status')
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .single();

        if (verificationError || !verification) {
            return NextResponse.json({ error: 'Seller verification required' }, { status: 403 });
        }

        // A pickup address is required before listing so shipping fees can be
        // calculated for buyers. Enforced here (not just in the UI) so it can't
        // be bypassed by calling the API directly.
        const { data: profile } = await authClient
            .from('profiles')
            .select('address_district_id, address_ward_code')
            .eq('id', user.id)
            .single();
        const sellerProfile = profile as { address_district_id: number | null; address_ward_code: string | null } | null;
        if (!sellerProfile?.address_district_id || !sellerProfile?.address_ward_code) {
            return NextResponse.json({
                error: 'Vui lòng thiết lập địa chỉ lấy hàng trước khi đăng bán.',
                code: 'MISSING_SELLER_ADDRESS',
            }, { status: 400 });
        }

        const body = await request.json();

        // Whitelist + validate — never spread the raw body into the insert.
        // (Previously `{...body}` let a caller set any column: status,
        // reserved_until, catalog keys to poison VN market pricing, etc.)
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const listingType = body.listing_type;
        const optionalString = (value: unknown) =>
            typeof value === 'string' && value.trim() ? value.trim() : null;
        const priceField = (value: unknown) => {
            const n = Number(value);
            return Number.isSafeInteger(n) && n >= MIN_MARKETPLACE_PRICE_VND ? n : null;
        };

        if (name.length < 5 || name.length > 200) {
            return NextResponse.json({ error: 'Tiêu đề cần 5-200 ký tự.' }, { status: 400 });
        }
        if (description.length < 300 || description.length > 5000) {
            return NextResponse.json({ error: 'Mô tả cần 300-5000 ký tự.' }, { status: 400 });
        }
        if (!['sale', 'auction', 'razz'].includes(listingType)) {
            return NextResponse.json({ error: 'listing_type không hợp lệ.' }, { status: 400 });
        }
        const imageUrl = optionalString(body.image_url);
        if (!imageUrl) {
            return NextResponse.json({ error: 'Cần ít nhất một ảnh.' }, { status: 400 });
        }
        const quantity = Number(body.quantity ?? 1);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
            return NextResponse.json({ error: 'Số lượng phải từ 1 đến 100.' }, { status: 400 });
        }
        const minOfferPercent = Number(body.min_offer_percent ?? 0);
        if (!Number.isFinite(minOfferPercent) || minOfferPercent < 0 || minOfferPercent > 100) {
            return NextResponse.json({ error: 'min_offer_percent phải từ 0 đến 100.' }, { status: 400 });
        }

        const cardData: Record<string, unknown> = {
            seller_id: user.id,
            status: 'active',
            name,
            description,
            listing_type: listingType,
            category: optionalString(body.category),
            condition: optionalString(body.condition),
            image_url: imageUrl,
            image_urls: Array.isArray(body.image_urls)
                ? body.image_urls.filter((url: unknown) => typeof url === 'string')
                : [imageUrl],
            publisher: optionalString(body.publisher),
            set_name: optionalString(body.set_name),
            season: optionalString(body.season),
            quantity,
            catalog_product_id: typeof body.catalog_product_id === 'number' ? body.catalog_product_id : null,
            catalog_soccer_id: typeof body.catalog_soccer_id === 'number' ? body.catalog_soccer_id : null,
            card_number: optionalString(body.card_number),
            language: optionalString(body.language),
            grading_company: optionalString(body.grading_company),
            grade: optionalString(body.grade),
            finish: optionalString(body.finish),
            accept_offers: body.accept_offers === true,
            min_offer_percent: body.accept_offers === true ? minOfferPercent : 0,
        };

        if (body.is_bundle === true) {
            cardData.is_bundle = true;
            cardData.bundle_items = Array.isArray(body.bundle_items) ? body.bundle_items : [];
        }

        if (listingType === 'sale') {
            const price = priceField(body.price);
            if (price === null) {
                return NextResponse.json({ error: `Giá bán tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
            }
            cardData.price = price;
        } else if (listingType === 'auction') {
            const startingBid = priceField(body.starting_bid);
            const auctionEnds = optionalString(body.auction_ends);
            if (startingBid === null) {
                return NextResponse.json({ error: `Giá khởi điểm tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
            }
            if (!auctionEnds || Number.isNaN(Date.parse(auctionEnds)) || Date.parse(auctionEnds) <= Date.now()) {
                return NextResponse.json({ error: 'Thời gian kết thúc đấu giá không hợp lệ.' }, { status: 400 });
            }
            cardData.starting_bid = startingBid;
            cardData.current_bid = startingBid;
            cardData.auction_ends = new Date(auctionEnds).toISOString();
        } else {
            const ticketPrice = priceField(body.ticket_price);
            const totalTickets = Number(body.total_tickets);
            if (ticketPrice === null) {
                return NextResponse.json({ error: `Giá vé tối thiểu là ${MIN_MARKETPLACE_PRICE_VND.toLocaleString('vi-VN')}đ.` }, { status: 400 });
            }
            if (!Number.isSafeInteger(totalTickets) || totalTickets < 2 || totalTickets > 1000) {
                return NextResponse.json({ error: 'Số vé razz phải từ 2 đến 1000.' }, { status: 400 });
            }
            cardData.ticket_price = ticketPrice;
            cardData.total_tickets = totalTickets;
            cardData.razz_entries = 0;
        }

        const { data: card, error: insertError } = await authClient
            .from('cards')
            .insert(cardData as never)
            .select('id')
            .single() as { data: { id: string } | null; error: { message?: string } | null };

        if (insertError || !card) {
            return NextResponse.json({ error: insertError?.message || 'Failed to create listing' }, { status: 400 });
        }

        return NextResponse.json({ success: true, cardId: card.id });
    } catch (error: any) {
        console.error('Create listing error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
