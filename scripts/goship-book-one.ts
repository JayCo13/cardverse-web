/**
 * Book one shipment through GoShip, by hand.
 *
 * Temporary. It exists to answer one question — what does GoShip's webhook
 * actually send — which no documentation of theirs does: doc.goship.io has no
 * endpoint reference and 404s on the webhook page its own homepage links to.
 * Once a real push has been read and the receiver parses it, delete this file.
 *
 * A script rather than a route on purpose. Booking dispatches a courier to a
 * real address, and that is not something to leave behind a button while the
 * flow around it is half built.
 *
 *   npx tsx scripts/goship-book-one.ts --city "Hồ Chí Minh"
 *   npx tsx scripts/goship-book-one.ts --districts 700000
 *   npx tsx scripts/goship-book-one.ts --wards 700100
 *   npx tsx scripts/goship-book-one.ts --from 700000/700100/8955 --to 100000/100300/1
 *   npx tsx scripts/goship-book-one.ts ... --book 0     # this one calls a courier
 */
import { readFileSync } from 'fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = 'https://api.goship.io/api/v2';
const TOKEN = process.env.GOSHIP_API?.trim() || '';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

async function api(path: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.json();
}

/**
 * Three separate lookups rather than one search.
 *
 * Wards live under districts, so finding a ward by name alone would mean
 * fetching every district of every city — seven hundred odd calls to name one
 * street. Walking down the levels is what the picker does and costs three.
 */
async function lookup() {
    const city = arg('city');
    if (city) {
        const rows = (await api('/cities')).data as Array<{ id: string; name: string }>;
        const low = city.toLowerCase();
        for (const c of rows) {
            if (c.name.toLowerCase().includes(low)) console.log(`  ${c.id}  ${c.name}`);
        }
        return true;
    }
    const districts = arg('districts');
    if (districts) {
        const rows = (await api(`/cities/${districts}/districts`)).data as Array<{ id: string; name: string }>;
        for (const d of rows) console.log(`  ${d.id}  ${d.name}`);
        return true;
    }
    const wards = arg('wards');
    if (wards) {
        const rows = (await api(`/districts/${wards}/wards`)).data as Array<{ id: number; name: string }>;
        for (const w of rows) console.log(`  ${w.id}  ${w.name}`);
        return true;
    }
    return false;
}

const parcel = {
    weight: Number(arg('weight') ?? 200),
    width: 15, height: 3, length: 20,
};

function place(spec: string | undefined, label: string) {
    const parts = (spec || '').split('/');
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
        throw new Error(`--${label} phải có dạng city/district/ward, ví dụ 700000/700100/8955`);
    }
    return { city: parts[0], district: parts[1], ward: parts[2] };
}

void (async () => {
    if (!TOKEN) { console.error('Thiếu GOSHIP_API trong .env'); return; }

    if (await lookup()) return;

    const from = place(arg('from'), 'from');
    const to = place(arg('to'), 'to');

    const quote = await api('/rates', { shipment: { address_from: from, address_to: to, parcel } });
    const rates = (quote.data || []) as Array<Record<string, any>>;
    if (rates.length === 0) { console.log('Không có hãng nào phục vụ tuyến này.', JSON.stringify(quote).slice(0, 200)); return; }

    rates.sort((a, b) => (a.total_fee || 0) - (b.total_fee || 0));
    console.log(`\n${rates.length} lựa chọn (${parcel.weight}g):`);
    rates.forEach((r, i) => {
        console.log(`  [${i}] ${String(r.total_fee).padStart(7)}đ  ${r.carrier_name} — ${r.service}  ${r.expected ?? ''}`);
    });

    const pick = arg('book');
    if (pick === undefined) {
        console.log('\nChỉ báo giá. Thêm --book <số> để đặt thật — lệnh đó GỌI SHIPPER tới lấy hàng.');
        return;
    }

    const chosen = rates[Number(pick)];
    if (!chosen) { console.error('Số lựa chọn không hợp lệ.'); return; }

    const contact = (side: 'from' | 'to') => ({
        street: arg(`${side}-street`) || '',
        name: arg(`${side}-name`) || '',
        phone: arg(`${side}-phone`) || '',
    });
    const f = { ...from, ...contact('from') };
    const t = { ...to, ...contact('to') };
    for (const [side, v] of [['from', f], ['to', t]] as const) {
        for (const k of ['street', 'name', 'phone'] as const) {
            if (!v[k]) { console.error(`Thiếu --${side}-${k}`); return; }
        }
    }

    console.log(`\nĐặt: ${chosen.carrier_name} — ${chosen.service}, ${chosen.total_fee}đ`);
    // amount is khai giá: what the carrier owes if the parcel is lost. Zero is
    // the default and would insure a card at nothing.
    const declared = Number(arg('declared') ?? 0);
    if (!declared) console.log('CẢNH BÁO: chưa khai giá (--declared), mất hàng sẽ không được đền.');
    const created = await api('/shipments', {
        shipment: {
            address_from: f, address_to: t,
            parcel: { ...parcel, cod: 0, amount: Math.round(declared) },
            rate: chosen.id, payer: 1,
        },
    });
    console.log(JSON.stringify(created, null, 2).slice(0, 2000));
})();
