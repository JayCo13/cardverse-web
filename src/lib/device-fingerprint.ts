/**
 * Device Fingerprint Generator (v3 — Incognito-proof)
 * 
 * Creates a stable device ID from browser signals that persists
 * across incognito sessions, cookie clears, and localStorage wipes.
 * 
 * REMOVED (unstable in incognito):
 * - Canvas rendering (Chrome adds noise)
 * - screen.width/height (changes per monitor/window)
 * - navigator.languages full list (Chrome strips in incognito)
 * - maxTouchPoints (Chrome changes in incognito)
 * 
 * STABLE signals used:
 * - WebGL renderer string (GPU-specific)
 * - Screen color/pixel depth + devicePixelRatio
 * - Primary language + timezone + platform
 * - Hardware concurrency + device memory
 * - Audio context sample rate
 */

// Simple hash function (djb2 variant)
function hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
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
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || '';
        const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || '';
        const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [];
        const extensions = (gl.getSupportedExtensions() || []).length;

        return `${vendor}~${renderer}~${maxTextureSize}~${maxRenderbufferSize}~${Array.from(maxViewportDims).join(',')}~${extensions}`;
    } catch {
        return 'webgl-error';
    }
}

function getDisplayFingerprint(): string {
    try {
        // Only use properties that DON'T change with window size or monitor
        return [
            screen.colorDepth,
            screen.pixelDepth,
            window.devicePixelRatio || 1,
        ].join('x');
    } catch {
        return 'display-error';
    }
}

function getSystemFingerprint(): string {
    try {
        const nav = navigator;
        return [
            nav.language || '',       // Primary language only (stable in incognito)
            nav.platform || '',       // e.g. "MacIntel"
            nav.hardwareConcurrency || 0,
            Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            // @ts-expect-error deviceMemory is not in all browsers
            nav.deviceMemory || 'unknown',
            // Do NOT include: languages list, maxTouchPoints, connection.type
        ].join('|');
    } catch {
        return 'system-error';
    }
}

function getAudioFingerprint(): string {
    try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const sampleRate = ctx.sampleRate;
        const maxChannels = ctx.destination.maxChannelCount;
        ctx.close();
        return `${sampleRate}~${maxChannels}`;
    } catch {
        return 'audio-error';
    }
}

/**
 * Generate a device fingerprint.
 * Returns a hex string that is stable across sessions AND incognito mode.
 */
export function getDeviceFingerprint(): string {
    const webgl = getWebGLFingerprint();
    const display = getDisplayFingerprint();
    const system = getSystemFingerprint();
    const audio = getAudioFingerprint();

    // DEBUG — remove after confirming incognito match
    console.log('[Fingerprint] WebGL:', webgl);
    console.log('[Fingerprint] Display:', display);
    console.log('[Fingerprint] System:', system);
    console.log('[Fingerprint] Audio:', audio);

    const signals = [webgl, display, system, audio];
    const combined = signals.join('||');
    
    const hash1 = hashString(combined);
    const hash2 = hashString(combined.split('').reverse().join(''));
    
    return `${hash1}${hash2}`;
}

/**
 * Cache the fingerprint in memory to avoid recalculating on every call.
 */
let cachedFingerprint: string | null = null;

export function getCachedDeviceFingerprint(): string {
    if (!cachedFingerprint) {
        cachedFingerprint = getDeviceFingerprint();
    }
    return cachedFingerprint;
}
