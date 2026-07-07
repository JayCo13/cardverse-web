import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { calculateShippingFee } from '@/lib/ghn';

// GHN's fee API is a paid third-party quota — this endpoint used to be an
// unauthenticated open proxy to it. Now: login required + per-user rate limit
// + sane numeric bounds (same in-memory pattern as /api/seller/ai-check).
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30; // checkout recalculates on address change; 30/min is generous
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || entry.resetAt <= now) {
        rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
        return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
}

// GHN insurance is capped at 500k in checkout/ship anyway; district ids are
// small positive integers.
const MAX_INSURANCE_VALUE = 500_000;
const MAX_DISTRICT_ID = 100_000;

export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const limit = checkRateLimit(user.id);
        if (!limit.allowed) {
            return NextResponse.json(
                { error: 'Too many requests, please slow down.' },
                { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
            );
        }

        const { searchParams } = new URL(request.url);
        const fromDistrictId = parseInt(searchParams.get('from_district_id') || '0');
        const fromWardCode = (searchParams.get('from_ward_code') || '').slice(0, 20);
        const toDistrictId = parseInt(searchParams.get('to_district_id') || '0');
        const toWardCode = (searchParams.get('to_ward_code') || '').slice(0, 20);
        const insuranceValue = parseInt(searchParams.get('insurance_value') || '0');

        if (!fromDistrictId || !fromWardCode || !toDistrictId || !toWardCode) {
            return NextResponse.json({
                error: 'from_district_id, from_ward_code, to_district_id, to_ward_code are required'
            }, { status: 400 });
        }

        if (
            !Number.isSafeInteger(fromDistrictId) || fromDistrictId < 1 || fromDistrictId > MAX_DISTRICT_ID ||
            !Number.isSafeInteger(toDistrictId) || toDistrictId < 1 || toDistrictId > MAX_DISTRICT_ID
        ) {
            return NextResponse.json({ error: 'Invalid district id' }, { status: 400 });
        }

        const boundedInsurance = Number.isSafeInteger(insuranceValue)
            ? Math.min(Math.max(insuranceValue, 0), MAX_INSURANCE_VALUE)
            : 0;

        const fee = await calculateShippingFee({
            fromDistrictId,
            fromWardCode,
            toDistrictId,
            toWardCode,
            insuranceValue: boundedInsurance,
        });

        return NextResponse.json({
            shipping_fee: fee.total,
            service_fee: fee.service_fee,
            insurance_fee: fee.insurance_fee,
            details: fee,
        });
    } catch (error: any) {
        console.error('Calculate shipping fee error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
