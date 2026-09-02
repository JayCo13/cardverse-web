import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { sendOfferPaymentReminder } from '@/lib/mail';

type LifecycleRow = {
    kind: 'remind' | 'expired';
    offer_id: string;
    buyer_id: string;
    card_id: string;
    card_name: string | null;
    price: number | null;
    deadline: string | null;
};

/**
 * One pass of the accepted-offer payment window.
 *
 * Reminds buyers whose window is closing and expires the ones who let it close:
 * the card goes back on the marketplace and, where the buyer had their
 * reminder, their standing takes the hit.
 *
 * The database does all of it in a single statement — reminders are claimed, so
 * running this twice never sends two — and hands back what it touched so the
 * mail can go out here.
 *
 * Fails closed without CRON_SECRET: this runs on the service role and relists
 * cards, so an anonymous caller must not be able to trigger it.
 */
export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const token = request.nextUrl.searchParams.get('token') || request.headers.get('x-cron-secret');
    if (!secret || token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const service = createServiceSupabaseClient();
        const { data, error } = await service.rpc('run_offer_payment_lifecycle' as never);
        if (error) throw new Error(error.message);

        const rows = (data || []) as LifecycleRow[];
        const reminders = rows.filter((row) => row.kind === 'remind');
        const expired = rows.filter((row) => row.kind === 'expired');

        // The claim is already committed, so a send that fails is not retried:
        // the alternative is releasing the claim and risking two reminders for
        // one deadline, which reads worse than one that never arrived. The
        // in-app notification is written either way.
        let delivered = 0;
        for (const reminder of reminders) {
            const { data: buyer } = await service.auth.admin.getUserById(reminder.buyer_id);
            const email = buyer.user?.email;
            if (!email) continue;
            const sent = await sendOfferPaymentReminder({
                to: email,
                cardName: reminder.card_name || '',
                offerId: reminder.offer_id,
                price: reminder.price ?? 0,
                deadline: reminder.deadline,
            });
            if (sent) delivered += 1;
        }

        console.log(
            `[Offers] payment lifecycle: ${reminders.length} reminded (${delivered} emailed), ${expired.length} expired`,
        );
        return NextResponse.json({
            reminded: reminders.length,
            emailed: delivered,
            expired: expired.length,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'error';
        console.error('[Offers] payment lifecycle failed:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
