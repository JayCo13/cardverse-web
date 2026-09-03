import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '@/lib/listing-description';
import { hashFinancialRequest } from '@/lib/financial-idempotency';

const MIN_MARKETPLACE_PRICE_VND = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    const startedAt = performance.now();
    try {
        const authClient = await createServerSupabaseClient();

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
        if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
            return NextResponse.json({ error: `Mô tả cần ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} ký tự.` }, { status: 400 });
        }
        if (!['sale', 'auction', 'razz'].includes(listingType)) {
            return NextResponse.json({ error: 'listing_type không hợp lệ.' }, { status: 400 });
        }
        const imageUrl = optionalString(body.image_url);
        if (!imageUrl) {
            return NextResponse.json({ error: 'Cần ít nhất một ảnh.' }, { status: 400 });
        }
        let quantity = Number(body.quantity ?? 1);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
            return NextResponse.json({ error: 'Số lượng phải từ 1 đến 100.' }, { status: 400 });
        }
        const minOfferPercent = Number(body.min_offer_percent ?? 0);
        if (!Number.isInteger(minOfferPercent) || minOfferPercent < 0 || minOfferPercent > 100) {
            return NextResponse.json({ error: 'min_offer_percent phải từ 0 đến 100.' }, { status: 400 });
        }

        const cardData: Record<string, unknown> = {
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
            grade: typeof body.grade === 'number' && Number.isFinite(body.grade) ? body.grade : null,
            finish: optionalString(body.finish),
            accept_offers: body.accept_offers === true,
            min_offer_percent: body.accept_offers === true ? minOfferPercent : 0,
        };

        if (body.is_bundle === true) {
            const bundleItems = Array.isArray(body.bundle_items) ? body.bundle_items : [];
            if (bundleItems.length < 1 || bundleItems.length > 100 || bundleItems.some((item: unknown) => {
                if (!item || typeof item !== 'object') return true;
                const value = item as { title?: unknown; price?: unknown };
                return typeof value.title !== 'string'
                    || !value.title.trim()
                    || !Number.isSafeInteger(Number(value.price))
                    || Number(value.price) < MIN_MARKETPLACE_PRICE_VND;
            })) {
                return NextResponse.json({ error: 'Bundle phải có 1-100 thẻ với tên và giá hợp lệ.' }, { status: 400 });
            }
            // A bundle's availability is its physical item count, never a
            // browser-supplied quantity.
            quantity = bundleItems.length;
            cardData.quantity = quantity;
            cardData.is_bundle = true;
            cardData.bundle_items = bundleItems;
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

        const suppliedKey = request.headers.get('idempotency-key');
        if (suppliedKey && !UUID_PATTERN.test(suppliedKey)) {
            return NextResponse.json(
                { error: 'Idempotency-Key must be a UUID.', code: 'invalid_idempotency_key' },
                { status: 400 },
            );
        }
        const idempotencyKey = suppliedKey || crypto.randomUUID();
        const dbStartedAt = performance.now();
        const { data, error: createError } = await authClient.rpc('create_marketplace_listing' as never, {
            p_idempotency_key: idempotencyKey,
            p_request_hash: hashFinancialRequest(cardData),
            p_card: cardData,
        } as never);
        const dbDuration = performance.now() - dbStartedAt;
        if (dbDuration >= 2000) {
            console.warn('Slow listing create RPC', { dbDurationMs: Math.round(dbDuration) });
        }

        if (createError) {
            const code = [
                'unauthorized', 'seller_verification_required', 'missing_seller_address',
                'missing_shipping_config', 'idempotency_conflict', 'invalid_listing_request',
                'invalid_listing_payload', 'invalid_listing_price', 'invalid_listing_auction',
                'invalid_listing_razz',
            ].find(value => createError.message.includes(value));
            const status = code === 'unauthorized' ? 401
                : code === 'seller_verification_required' ? 403
                    : code === 'idempotency_conflict' ? 409
                        : 400;
            const responseCode = code === 'missing_seller_address' ? 'MISSING_SELLER_ADDRESS'
                : code === 'missing_shipping_config' ? 'MISSING_SHIPPING_CONFIG'
                    : code;
            const response = NextResponse.json(
                { error: createError.message || 'Failed to create listing', code: responseCode },
                { status },
            );
            response.headers.set('Server-Timing', `listing-db;dur=${dbDuration.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`);
            return response;
        }

        const response = NextResponse.json(data);
        response.headers.set('Server-Timing', `listing-db;dur=${dbDuration.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`);
        return response;
    } catch (error: unknown) {
        console.error('Create listing error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
