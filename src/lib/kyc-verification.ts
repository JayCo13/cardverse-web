import { createHmac, timingSafeEqual } from 'crypto';

type PhoneVerificationPayload = {
    userId: string;
    phoneNumber: string;
    exp: number;
};

function getKycSecret() {
    const secret = process.env.KYC_VERIFICATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
        throw new Error('KYC verification secret is not configured');
    }
    return secret;
}

function encodeBase64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string) {
    return createHmac('sha256', getKycSecret()).update(payload).digest('base64url');
}

export function createPhoneVerificationToken(userId: string, phoneNumber: string) {
    const payload: PhoneVerificationPayload = {
        userId,
        phoneNumber,
        exp: Date.now() + 30 * 60 * 1000,
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function verifyPhoneVerificationToken(token: string, userId: string) {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        throw new Error('Invalid phone verification token');
    }

    const expectedSignature = signPayload(encodedPayload);
    const received = Buffer.from(signature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        throw new Error('Invalid phone verification token signature');
    }

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as PhoneVerificationPayload;
    if (payload.userId !== userId) {
        throw new Error('Phone verification token does not belong to this user');
    }
    if (payload.exp < Date.now()) {
        throw new Error('Phone verification token has expired');
    }
    if (!payload.phoneNumber) {
        throw new Error('Phone verification token is missing phone number');
    }

    return payload.phoneNumber;
}

export function normalizeVietnameseName(name: string) {
    return name
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Compare two names for the same person, ignoring word order.
 *
 * Vietnamese names are family-name-first, but banks, ID documents and MRZ
 * fields do not agree on that: the same person can be "CO TRINH HIEN TAI" on a
 * CCCD and "TAI CO TRINH HIEN" in a bank record. Comparing the words as a
 * multiset accepts those orderings while still rejecting a different name, a
 * missing word, or a duplicated one.
 */
export function namesMatch(a: string, b: string) {
    const tokens = (value: string) => {
        const words = normalizeVietnameseName(value).split(' ').filter(Boolean);
        return words.length ? words.sort().join(' ') : '';
    };
    const left = tokens(a);
    return !!left && left === tokens(b);
}
