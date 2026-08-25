import { createHmac, timingSafeEqual } from 'crypto';
import type {
    CreateKycSessionInput,
    CreatedKycSession,
    KycDecision,
    KycIdentity,
    KycProvider,
    KycStatus,
    KycWarning,
    KycWebhookEvent,
} from './types';

const DEFAULT_BASE_URL = 'https://verification.didit.me';

/** Webhook replay window enforced by Didit. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

const KNOWN_STATUSES: readonly string[] = [
    'Not Started',
    'In Progress',
    'Awaiting User',
    'Approved',
    'Declined',
    'In Review',
    'Resubmitted',
    'Abandoned',
    'Expired',
    'Kyc Expired',
];

function baseUrl() {
    return (process.env.DIDIT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function apiKey() {
    const key = process.env.DIDIT_API_KEY;
    if (!key) throw new Error('DIDIT_API_KEY is not configured');
    return key;
}

function workflowId() {
    const id = process.env.DIDIT_WORKFLOW_ID;
    if (!id) throw new Error('DIDIT_WORKFLOW_ID is not configured');
    return id;
}

function webhookSecret() {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) throw new Error('DIDIT_WEBHOOK_SECRET is not configured');
    return secret;
}

function toStatus(value: unknown): KycStatus {
    const raw = typeof value === 'string' ? value : '';
    return (KNOWN_STATUSES.includes(raw) ? raw : 'Not Started') as KycStatus;
}

// ─── Signature verification ──────────────────────────────────────────────────

/**
 * Didit's backend canonicalises with Python's
 * `json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=False)`.
 * JSON.stringify already emits compact JSON and leaves non-ASCII unescaped, so
 * the only thing to reproduce is the recursive key ordering.
 *
 * Python's `shorten_floats` (1.0 -> 1) has no JS counterpart to implement:
 * JSON.parse collapses 1.0 to the number 1, which re-serialises as "1".
 */
function canonicalise(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalise((value as Record<string, unknown>)[key])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
}

function hmacHex(payload: string, secret: string) {
    return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function signatureMatches(expectedHex: string, receivedHex: string) {
    // Compare as hex text, not decoded bytes: a malformed header would decode
    // to a short buffer and could otherwise slip past a length check.
    const expected = Buffer.from(expectedHex, 'utf8');
    const received = Buffer.from(receivedHex.trim().toLowerCase(), 'utf8');
    return expected.length === received.length && timingSafeEqual(expected, received);
}

function timestampIsFresh(timestamp: number) {
    if (!Number.isFinite(timestamp)) return false;
    const now = Math.floor(Date.now() / 1000);
    return Math.abs(now - timestamp) <= SIGNATURE_TOLERANCE_SECONDS;
}

// ─── Decision normalisation ──────────────────────────────────────────────────

/**
 * v3 returns feature arrays (`id_verifications`, `liveness_checks`, …). Older
 * workflows and some sandbox payloads still use the singular v2 keys, so read
 * both rather than assuming a shape we do not control.
 */
function feature<T = Record<string, unknown>>(
    payload: Record<string, unknown>,
    pluralKey: string,
    singularKey: string
): T | null {
    const plural = payload[pluralKey];
    if (Array.isArray(plural) && plural.length > 0) return plural[0] as T;
    const singular = payload[singularKey];
    if (singular && typeof singular === 'object') return singular as T;
    return null;
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Accepts YYYY-MM-DD and DD/MM/YYYY (what CCCD OCR commonly yields). */
function toIsoDate(value: unknown): string | null {
    const raw = str(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const dmy = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return null;
}

function collectWarnings(...items: Array<Record<string, unknown> | null>): KycWarning[] {
    const out: KycWarning[] = [];
    for (const item of items) {
        const warnings = item?.warnings;
        if (!Array.isArray(warnings)) continue;
        for (const w of warnings as Array<Record<string, unknown>>) {
            out.push({
                feature: str(w.feature),
                risk: str(w.risk),
                logType: str(w.log_type),
                shortDescription: str(w.short_description),
                longDescription: str(w.long_description),
            });
        }
    }
    return out;
}

function normaliseIdentity(payload: Record<string, unknown>): KycIdentity {
    const id = feature<Record<string, unknown>>(payload, 'id_verifications', 'id_verification');
    const liveness = feature<Record<string, unknown>>(payload, 'liveness_checks', 'liveness');
    const faceMatch = feature<Record<string, unknown>>(payload, 'face_matches', 'face_match');
    const nfc = feature<Record<string, unknown>>(payload, 'nfc_verifications', 'nfc_verification');

    const mrz = (id?.mrz && typeof id.mrz === 'object' ? (id.mrz as Record<string, unknown>) : null);
    const chip = (nfc?.chip_data && typeof nfc.chip_data === 'object'
        ? (nfc.chip_data as Record<string, unknown>)
        : null);

    const issuingState = str(id?.issuing_state) || str(id?.issuing_state_name) || str(chip?.issuing_state);
    const isVietnamese = /^VN|^VNM/i.test(issuingState || '');

    /**
     * Join split name parts in the order the issuing country prints them.
     * Vietnamese documents are family-name-first, so the Western first+last
     * join reverses them into a different name.
     */
    const joinParts = (first: string | null, last: string | null) => {
        const parts = isVietnamese ? [last, first] : [first, last];
        return str(parts.filter(Boolean).join(' '));
    };

    /**
     * The MRZ is the only field that preserves the document's own name order:
     * `surname` then `name` (the given names), exactly as printed.
     *
     * Didit's `full_name` cannot be used for a Vietnamese card. It is not the
     * printed name — it is reassembled Western-style, which turns
     * "QUACH THANH NHA" into "Nha Thanh Quach", reversing both the surname
     * position and the order of the given names. `first_name` carries the same
     * reversal, so rebuilding from the split parts does not recover it either.
     *
     * Upper-cased because that is how a CCCD prints a name, and because the MRZ
     * mixes cases between reads (`Quach` one time, `QUACH` the next).
     */
    const mrzFullName = (() => {
        const joined = [str(mrz?.surname), str(mrz?.name)].filter(Boolean).join(' ');
        return joined ? joined.toUpperCase() : null;
    })();

    // Chip first when NFC ran: it is issuer-signed data, not a read of a
    // photograph, so it cannot drop a character or reorder anything. Everything
    // below it is OCR and can.
    const fullName = isVietnamese
        ? (joinParts(str(chip?.first_name), str(chip?.last_name))
            || mrzFullName
            || joinParts(str(id?.first_name), str(id?.last_name))
            || str(id?.full_name))
        : (str(id?.full_name)
            || str(chip?.full_name)
            || joinParts(str(id?.first_name), str(id?.last_name))
            || mrzFullName);

    const nfcSkipped = nfc?.is_nfc_skipped;
    const authenticity = (nfc?.authenticity && typeof nfc.authenticity === 'object'
        ? (nfc.authenticity as Record<string, unknown>)
        : null);

    return {
        fullName,
        dateOfBirth: toIsoDate(chip?.date_of_birth ?? id?.date_of_birth ?? mrz?.date_of_birth),
        documentNumber: isVietnamese
            ? pickCccd(
                chip?.document_number, id?.personal_number, mrz?.personal_number,
                id?.document_number, mrz?.document_number,
            )
            : (str(chip?.document_number)
                || str(id?.document_number)
                || str(id?.personal_number)
                || str(mrz?.document_number)),
        documentType: str(chip?.document_type) || str(id?.document_type),
        issuingState,
        livenessScore: num(liveness?.score),
        faceMatchScore: num(faceMatch?.score),
        nfcVerified:
            !!nfc &&
            nfcSkipped !== true &&
            authenticity?.sod_integrity !== false &&
            authenticity?.dg_integrity !== false,
        warnings: [...collectWarnings(id, liveness, faceMatch, nfc), ...mrzReadWarnings(mrz)],
    };
}

/**
 * A Vietnamese CCCD number is exactly 12 digits. Several fields claim to hold
 * it and only some do: the MRZ `document_number` is a shorter derived value,
 * while `personal_number` embeds the real one among filler ("096205005744<YK").
 *
 * Requiring exactly 12 digits picks the right field and, usefully, rejects a
 * misread outright rather than storing a number that differs between scans of
 * the same card — which would silently defeat duplicate detection, since that
 * compares an HMAC of this value.
 */
function pickCccd(...candidates: unknown[]): string | null {
    for (const candidate of candidates) {
        const raw = str(candidate);
        if (!raw) continue;
        const digits = raw.replace(/\D/g, '');
        if (digits.length === 12) return digits;
    }
    return null;
}

/**
 * MRZ parse errors that indicate the read itself is unreliable.
 *
 * Vietnamese cards routinely fail the final check digit — a clean scan still
 * reports "false final hash" — so that one alone means nothing. Anything
 * further (a birth date, nationality or expiry that will not parse) has, in
 * the scans seen so far, accompanied a corrupted name: one read returned
 * "THAN" where the card says "THANH", and a document number differing from
 * the same card's other scans.
 *
 * These only hold a submission for review; they never reject it.
 */
const BENIGN_MRZ_ERRORS = ['false final hash'];

function mrzReadWarnings(mrz: Record<string, unknown> | null): KycWarning[] {
    if (!mrz) return [];
    const errors = Array.isArray(mrz.errors) ? mrz.errors.map((e) => String(e)) : [];
    const significant = errors.filter(
        (error) => !BENIGN_MRZ_ERRORS.includes(error.trim().toLowerCase()),
    );
    if (significant.length === 0) return [];

    return [{
        feature: 'ID_VERIFICATION',
        risk: 'MRZ_READ_UNRELIABLE',
        logType: 'warning',
        shortDescription: 'Vùng máy đọc trên giấy tờ lỗi — họ tên hoặc số giấy tờ có thể bị đọc sai.',
        longDescription: `Lỗi MRZ: ${significant.join('; ')}`,
    }];
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * Fallback ceiling for a provider call when the caller does not say how much
 * of its own budget is left.
 *
 * Must stay below the platform's function timeout (10s on Netlify by default).
 * Otherwise a slow provider takes the whole function down and the caller gets
 * an HTML 502 from the edge instead of a JSON error it can act on. Callers
 * that have already spent part of that budget on auth and database round trips
 * pass a smaller number — a fixed 7s here plus their own latency is exactly
 * how the function ends up over the limit.
 */
const REQUEST_TIMEOUT_MS = 7_000;

/** Below this a call cannot realistically complete; fail fast instead. */
const MIN_TIMEOUT_MS = 1_000;

function resolveTimeout(timeoutMs?: number) {
    if (!Number.isFinite(timeoutMs)) return REQUEST_TIMEOUT_MS;
    return Math.min(REQUEST_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(timeoutMs as number)));
}

async function diditFetch(path: string, init: RequestInit, timeoutMs?: number) {
    const budget = resolveTimeout(timeoutMs);
    let response: Response;
    try {
        response = await fetch(`${baseUrl()}${path}`, {
            ...init,
            headers: {
                'x-api-key': apiKey(),
                'Content-Type': 'application/json',
                ...(init.headers || {}),
            },
            signal: AbortSignal.timeout(budget),
        });
    } catch (error) {
        const name = (error as Error)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new Error(`Didit ${path} timed out after ${budget}ms`);
        }
        throw new Error(`Didit ${path} unreachable: ${(error as Error)?.message || 'network error'}`);
    }

    const text = await response.text();
    let body: unknown = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }

    if (!response.ok) {
        const detail =
            (body as Record<string, unknown>)?.detail ||
            (body as Record<string, unknown>)?.message ||
            (body as Record<string, unknown>)?.error ||
            text.slice(0, 200);
        throw new Error(`Didit ${path} failed: HTTP ${response.status} — ${detail}`);
    }

    return body as Record<string, unknown>;
}

export const diditProvider: KycProvider = {
    name: 'didit',

    async createSession(input: CreateKycSessionInput): Promise<CreatedKycSession> {
        const body: Record<string, unknown> = {
            workflow_id: workflowId(),
            vendor_data: input.userId,
            callback: input.callbackUrl,
            language: input.language || 'vi',
        };

        if (input.email) {
            body.contact_details = { email: input.email, email_lang: input.language || 'vi' };
        }

        // Hint only — Didit reports what it actually read; we re-check the name
        // ourselves against the returned identity before approving anything.
        if (input.expectedFullName) {
            body.expected_details = { id_country: 'VNM' };
        }

        const data = await diditFetch('/v3/session/', {
            method: 'POST',
            body: JSON.stringify(body),
        }, input.timeoutMs);

        const providerSessionId = str(data.session_id);
        const url = str(data.url);
        if (!providerSessionId || !url) {
            throw new Error('Didit create session returned no session_id/url');
        }

        return {
            providerSessionId,
            url,
            status: toStatus(data.status),
            workflowId: str(data.workflow_id),
        };
    },

    async getDecision(providerSessionId: string, timeoutMs?: number): Promise<KycDecision> {
        const data = await diditFetch(
            `/v3/session/${encodeURIComponent(providerSessionId)}/decision/`,
            { method: 'GET' },
            timeoutMs
        );

        return {
            providerSessionId,
            status: toStatus(data.status),
            identity: normaliseIdentity(data),
            raw: data,
        };
    },

    parseWebhook(rawBody: string, headers: Headers): KycWebhookEvent | null {
        let secret: string;
        try {
            secret = webhookSecret();
        } catch {
            return null;
        }

        let body: Record<string, unknown>;
        try {
            body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
            return null;
        }

        const headerTimestamp = num(headers.get('x-timestamp'));
        const timestamp = headerTimestamp ?? num(body.timestamp) ?? num(body.created_at);
        if (timestamp === null || !timestampIsFresh(timestamp)) return null;

        const v2 = headers.get('x-signature-v2');
        const simple = headers.get('x-signature-simple');
        const original = headers.get('x-signature');

        // V2 first: it survives any middleware that re-encodes the body, which
        // matters because Vietnamese names carry diacritics.
        let verified = false;

        if (v2) {
            verified = signatureMatches(hmacHex(canonicalise(body), secret), v2);
        }

        if (!verified && simple) {
            const canonical = [
                String(body.timestamp ?? ''),
                String(body.session_id ?? ''),
                String(body.status ?? ''),
                String(body.webhook_type ?? ''),
            ].join(':');
            verified = signatureMatches(hmacHex(canonical, secret), simple);
        }

        if (!verified && original) {
            verified = signatureMatches(hmacHex(rawBody, secret), original);
        }

        if (!verified) return null;

        const providerSessionId = str(body.session_id);
        if (!providerSessionId) return null;

        return {
            eventId: str(body.event_id),
            webhookType: str(body.webhook_type),
            providerSessionId,
            status: toStatus(body.status),
            vendorData: str(body.vendor_data),
        };
    },
};
