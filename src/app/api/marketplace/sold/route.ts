import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Public aggregated "sold cards" feed: card + asking price + actual sold price
// (an accepted offer shows as a lower sold price). No buyer/seller PII.
export async function GET() {
    const service = createServiceSupabaseClient();

    // A real sale = a non-cancelled, paid-or-later order. Cancelled orders relist
    // the card, so they are excluded.
    const { data, error } = await service
        .from('orders')
        .select(`
            id, amount, created_at, status,
            card:cards(id, name, image_url, category, condition, price, is_bundle)
        `)
        .in('status', ['paid', 'shipping', 'delivered', 'completed'])
        .order('created_at', { ascending: false })
        .limit(120);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data || [])
        .filter((o: any) => o.card)
        .map((o: any) => {
            const asking = Number(o.card.price || 0);
            const sold = Number(o.amount || 0);
            return {
                orderId: o.id,
                cardId: o.card.id,
                name: o.card.name,
                image: o.card.image_url,
                category: o.card.category,
                condition: o.card.condition,
                isBundle: !!o.card.is_bundle,
                askingPrice: asking,
                soldPrice: sold,
                // Sold below the asking price ⇒ closed via an accepted offer.
                isOffer: asking > 0 && sold > 0 && sold < asking,
                status: o.status,
                soldAt: o.created_at,
            };
        });

    return NextResponse.json({ items });
}
