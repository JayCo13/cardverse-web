/**
 * Device Fingerprint Generator
 * 
 * Creates a stable, unique-ish device ID from browser signals that persists
 * across incognito sessions, cookie clears, and localStorage wipes.
 * 
 * Signals used:
 * - Canvas rendering (unique per GPU/driver combo)
 * - WebGL renderer string
 * - Screen resolution + color depth
 * - Timezone + language
 * - Platform + hardware concurrency
 * - Touch support + device memory
 */

// Simple hash function (djb2 variant) — no crypto dependency needed
function hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    // Convert to hex and pad to ensure consistent length
    return Math.abs(hash).toString(16).padStart(8, '0');
}

function getCanvasFingerprint(): string {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'no-canvas';

        // Draw text with specific styling — renders differently per GPU/driver
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.font = '11pt Arial';
        ctx.fillText('CardVerse,🃏', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.font = '18pt Arial';
        ctx.fillText('CardVerse,🃏', 4, 45);

        // Add some geometric shapes for more uniqueness
        ctx.beginPath();
        ctx.arc(50, 25, 20, 0, Math.PI * 2);
        ctx.fill();

        return canvas.toDataURL();
    } catch {
        return 'canvas-error';
    }
}

function getWebGLFingerprint(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl || !(gl instanceof WebGLRenderingContext)) return 'no-webgl';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return 'no-debug-info';

        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        return `${vendor}~${renderer}`;
    } catch {
        return 'webgl-error';
    }
}

function getScreenFingerprint(): string {
    try {
        return [
            screen.width,
            screen.height,
            screen.colorDepth,
            screen.pixelDepth,
            window.devicePixelRatio || 1,
        ].join('x');
    } catch {
        return 'screen-error';
    }
}

function getSystemFingerprint(): string {
    try {
        const nav = navigator;
        return [
            nav.language || '',
            nav.languages?.join(',') || '',
            nav.platform || '',
            nav.hardwareConcurrency || 0,
            Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            nav.maxTouchPoints || 0,
            // @ts-expect-error deviceMemory is not in all browsers
            nav.deviceMemory || 'unknown',
        ].join('|');
    } catch {
        return 'system-error';
    }
}

/**
 * Generate a device fingerprint.
 * Returns a hex string that is stable across sessions, incognito, and cookie clears.
 * 
 * @returns Device fingerprint string (16 hex chars)
 */
export function getDeviceFingerprint(): string {
    const signals = [
        getCanvasFingerprint(),
        getWebGLFingerprint(),
        getScreenFingerprint(),
        getSystemFingerprint(),
    ];

    const combined = signals.join('||');
    
    // Double-hash for better distribution
    const hash1 = hashString(combined);
    const hash2 = hashString(combined.split('').reverse().join(''));
    
    return `${hash1}${hash2}`;
}

/**
 * Cache the fingerprint in memory to avoid recalculating on every call.
 * (Canvas operations are somewhat expensive)
 */
let cachedFingerprint: string | null = null;

export function getCachedDeviceFingerprint(): string {
    if (!cachedFingerprint) {
        cachedFingerprint = getDeviceFingerprint();
    }
    return cachedFingerprint;
}
