// Local OCR to read a card's collector number WITHOUT calling the AI.
// Used as the first tier of scanning: if Tesseract reads a well-formed card
// number from the bottom of the card, we match the catalog directly and skip
// Gemini entirely (cheaper). Only falls back to AI when OCR is unsure.
//
// Everything here is browser-only (canvas, Tesseract WASM) and lazy-loaded, so
// none of it ships in the initial bundle.

/* eslint-disable @typescript-eslint/no-explicit-any */

let workerPromise: Promise<any> | null = null;

async function getWorker() {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker('eng');
            await worker.setParameters({
                // card numbers are digits + a few letters + separators only
                tessedit_char_whitelist: '0123456789/-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                tessedit_pageseg_mode: '11', // sparse text — find numbers anywhere
            });
            return worker;
        })();
    }
    return workerPromise;
}

// Crop the bottom strip (where the collector number is printed) and upscale it
// so the small text is more legible to OCR.
async function cropBottomStrip(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // Thin bottom strip = the row that holds the collector number, WITHOUT
            // the attack/flavor text above it (that text was drowning the number).
            const stripH = Math.max(40, Math.round(img.height * 0.15)); // bottom 15%
            const scale = 3; // upscale small text for OCR
            const canvas = document.createElement('canvas');
            canvas.width = img.width * scale;
            canvas.height = stripH * scale;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(dataUrl); return; }
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, 0, img.height - stripH, img.width, stripH, 0, 0, canvas.width, canvas.height);
            // Grayscale + contrast boost so the number stands out from the art.
            try {
                const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = im.data;
                for (let i = 0; i < d.length; i += 4) {
                    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    v = (v - 128) * 1.6 + 128;        // contrast
                    v = v < 0 ? 0 : v > 255 ? 255 : v;
                    d[i] = d[i + 1] = d[i + 2] = v;
                }
                ctx.putImageData(im, 0, 0);
            } catch { /* tainted canvas etc. — use as-is */ }
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

export interface OcrCardResult {
    cardId: string;
    category: 'pokemon' | 'onepiece';
}

// Parse a card number out of raw OCR text. Returns null unless it matches a
// well-formed pattern (the confidence gate — vague text → fall back to AI).
function parseCardNumber(textRaw: string): OcrCardResult | null {
    const text = textRaw.toUpperCase().replace(/\s+/g, ' ');

    // One Piece: OP15-118, ST09-014, EB02-052, PRB01-001, P-001
    const op = text.match(/\b(OP|ST|EB|PRB|P)\s?-?\s?(\d{1,2})\s?-\s?(\d{2,3})\b/);
    if (op) {
        return { cardId: `${op[1]}${op[2].padStart(2, '0')}-${op[3].padStart(3, '0')}`, category: 'onepiece' };
    }

    // Pokémon slash format: 012/198, 55/102, TG12/TG30, RC10/RC32, 055A/111
    const pk = text.match(/\b([A-Z]{0,3}\d{1,3}[A-Z]?)\s?\/\s?([A-Z]{0,3}\d{1,3})\b/);
    if (pk) {
        return { cardId: `${pk[1]}/${pk[2]}`, category: 'pokemon' };
    }

    // Pokémon no-slash promos with a recognised prefix (avoid matching noise)
    const promo = text.match(/\b(SWSH|HGSS|GG|TG|RC|SV|SM|XY|BW|DP)\d{2,3}\b/);
    if (promo) {
        return { cardId: promo[0], category: 'pokemon' };
    }

    return null;
}

/**
 * OCR the card's number locally. `imageBase64` may be a raw base64 string or a
 * data URL. Returns a confident {cardId, category} or null (→ caller uses AI).
 */
export async function ocrCardNumber(imageBase64: string): Promise<OcrCardResult | null> {
    const t0 = (globalThis.performance?.now?.() ?? 0);
    try {
        console.log('[OCR] starting (loading Tesseract + reading bottom strip)…');
        const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
        const strip = await cropBottomStrip(dataUrl);
        const worker = await getWorker();
        const { data } = await worker.recognize(strip);
        const raw = (data.text || '').replace(/\n/g, ' ').trim();
        const ms = Math.round((globalThis.performance?.now?.() ?? 0) - t0);
        console.log(`[OCR] raw text (${ms}ms): "${raw.slice(0, 160)}"`);
        const parsed = parseCardNumber(raw);
        console.log(parsed ? `[OCR] ✓ parsed number: ${parsed.cardId} (${parsed.category})` : '[OCR] ✗ no valid card number in text → AI fallback');
        return parsed;
    } catch (e) {
        console.warn('[OCR] error → AI fallback:', e);
        return null;
    }
}

// ── Lightweight perceptual cache (avoid re-OCR/re-AI for the same card) ──
// 8x8 average hash → 64-bit fingerprint; cache hit if Hamming distance ≤ 6.

export async function averageHash(dataUrlOrBase64: string): Promise<string> {
    const dataUrl = dataUrlOrBase64.startsWith('data:') ? dataUrlOrBase64 : `data:image/jpeg;base64,${dataUrlOrBase64}`;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = 8; c.height = 8;
            const ctx = c.getContext('2d');
            if (!ctx) { resolve(''); return; }
            ctx.drawImage(img, 0, 0, 8, 8);
            const d = ctx.getImageData(0, 0, 8, 8).data;
            const lum: number[] = [];
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) {
                const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                lum.push(l); sum += l;
            }
            const mean = sum / lum.length;
            resolve(lum.map((l) => (l > mean ? '1' : '0')).join(''));
        };
        img.onerror = () => resolve('');
        img.src = dataUrl;
    });
}

export function hamming(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) return 999;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
}
