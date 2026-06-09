"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, SpinnerGap, Lightning } from "@phosphor-icons/react";

/**
 * Live camera scanner with an alignment frame + scan-beam effect and
 * auto-capture. Built for the "check a price fast" flow: point the phone so the
 * frame covers a card — physical OR shown on another screen (e.g. an auction
 * about to end) — hold briefly and it captures, cropping to the frame so the
 * card fills the image. Steadiness + detail heuristic (no CV library). Manual
 * shutter + Auto toggle remain.
 */
export function CameraScanner({
    open,
    onClose,
    onCapture,
}: {
    open: boolean;
    onClose: () => void;
    onCapture: (base64Jpeg: string) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const capturedRef = useRef(false);
    const autoRef = useRef(true);
    const prevSampleRef = useRef<Float32Array | null>(null);
    const stableRef = useRef(0);
    const sharpPeakRef = useRef(0); // best sharpness seen this session
    const contentTicksRef = useRef(0); // consecutive ticks a card has been in view
    const lockingRef = useRef(false); // about to capture (short green confirm)
    const zoomRef = useRef(1);
    const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [autoOn, setAutoOn] = useState(true);
    const [progress, setProgress] = useState(0); // 0..1 stabilization
    const [focusing, setFocusing] = useState(false); // steady but waiting for sharp focus
    const [aiming, setAiming] = useState(false); // a card is framed (show amber outline)
    const [locked, setLocked] = useState(false); // green "locked → capturing" confirm
    const [zoom, setZoom] = useState(1);
    const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);

    const STEADY_NEED = 3; // consecutive steady samples (~0.6s) before auto-fire

    // Map the on-screen frame box → the video's intrinsic pixels (object-cover).
    const computeCrop = () => {
        const video = videoRef.current;
        const frame = frameRef.current;
        if (!video || !frame || !video.videoWidth) return null;
        const vW = video.videoWidth, vH = video.videoHeight;
        const rect = video.getBoundingClientRect();
        const fr = frame.getBoundingClientRect();
        const scale = Math.max(rect.width / vW, rect.height / vH);
        const offX = (rect.width - vW * scale) / 2;
        const offY = (rect.height - vH * scale) / 2;
        let sx = (fr.left - rect.left - offX) / scale;
        let sy = (fr.top - rect.top - offY) / scale;
        let sw = fr.width / scale;
        let sh = fr.height / scale;
        sx = Math.max(0, Math.min(sx, vW)); sy = Math.max(0, Math.min(sy, vH));
        sw = Math.min(sw, vW - sx); sh = Math.min(sh, vH - sy);
        return { sx, sy, sw, sh };
    };

    const doCapture = () => {
        if (capturedRef.current) return;
        const crop = computeCrop();
        const video = videoRef.current;
        if (!crop || !video) return;
        capturedRef.current = true;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(crop.sw);
        canvas.height = Math.round(crop.sh);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCapture(dataUrl.split(",")[1]);
    };

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        let lockTimer: ReturnType<typeof setTimeout> | null = null;
        // Sample at a usable resolution so blur is actually detectable (small text
        // like the card number washes out if we downscale too far).
        const SW = 120, SH = 160;
        const sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = SW; sampleCanvas.height = SH;
        const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
        // Separate COARSE sample for stability: at this resolution small hand-shake
        // barely changes the pixels (sub-pixel), so steadiness no longer depends on
        // how detailed/sharp the framed card is.
        const CW = 16, CH = 22;
        const stabCanvas = document.createElement("canvas");
        stabCanvas.width = CW; stabCanvas.height = CH;
        const stctx = stabCanvas.getContext("2d", { willReadFrequently: true });

        capturedRef.current = false;
        lockingRef.current = false;
        prevSampleRef.current = null;
        stableRef.current = 0;
        sharpPeakRef.current = 0;
        contentTicksRef.current = 0;
        zoomRef.current = 1;
        setError(null); setReady(false); setProgress(0); setFocusing(false); setLocked(false); setAiming(false);
        setZoom(1); setZoomCaps(null);

        const tick = () => {
            if (!autoRef.current || capturedRef.current || !sctx) return;
            const crop = computeCrop();
            const video = videoRef.current;
            if (!crop || !video) return;
            sctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, SW, SH);
            const data = sctx.getImageData(0, 0, SW, SH).data;
            const N = SW * SH;
            const lum = new Float32Array(N);
            let sum = 0;
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                lum[j] = l; sum += l;
            }
            const mean = sum / N;
            let variance = 0;
            for (let j = 0; j < N; j++) { const d = lum[j] - mean; variance += d * d; }
            variance /= N;

            // Stability from the COARSE sample (robust to fine detail / sharpness):
            // mean abs luminance diff vs the previous coarse frame.
            stctx!.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, CW, CH);
            const cdata = stctx!.getImageData(0, 0, CW, CH).data;
            const CN = CW * CH;
            const clum = new Float32Array(CN);
            for (let i = 0, j = 0; i < cdata.length; i += 4, j++) {
                clum[j] = 0.299 * cdata[i] + 0.587 * cdata[i + 1] + 0.114 * cdata[i + 2];
            }
            const prev = prevSampleRef.current;
            let diff = Infinity;
            if (prev && prev.length === CN) {
                let d = 0;
                for (let j = 0; j < CN; j++) d += Math.abs(clum[j] - prev[j]);
                diff = d / CN;
            }
            prevSampleRef.current = clum;

            // Sharpness = variance of the Laplacian (classic focus/blur metric).
            // Low when the image is out of focus or motion-blurred.
            let lapSum = 0, lapSq = 0, cnt = 0;
            for (let y = 1; y < SH - 1; y++) {
                for (let x = 1; x < SW - 1; x++) {
                    const idx = y * SW + x;
                    const lap = 4 * lum[idx] - lum[idx - 1] - lum[idx + 1] - lum[idx - SW] - lum[idx + SW];
                    lapSum += lap; lapSq += lap * lap; cnt++;
                }
            }
            const lapMean = lapSum / cnt;
            const sharp = lapSq / cnt - lapMean * lapMean;
            // Adaptive peak: jump up to new highs but DECAY otherwise, so it
            // tracks the current scene/zoom level instead of a stale transient max.
            sharpPeakRef.current = sharp > sharpPeakRef.current
                ? sharp
                : Math.max(sharp, sharpPeakRef.current * 0.93);
            const focused = sharp > 8 && sharp >= sharpPeakRef.current * 0.7;

            const contentOk = variance > 130 && mean > 20 && mean < 245;
            // Zoom magnifies hand-shake, so the same physical wobble moves the image
            // much more when zoomed in. Scale the steadiness tolerance with the zoom
            // factor, otherwise auto-capture can NEVER reach "steady" while zoomed.
            const zoomFactor = zoomCaps ? Math.max(1, zoomRef.current / Math.max(0.0001, zoomCaps.min)) : 1;
            const diffThresh = 13 * Math.min(5, zoomFactor);
            const steady = prev !== null && diff < diffThresh && contentOk;
            // Soft decay (not hard reset) so a single jittery frame doesn't undo
            // all the steadiness we built up — makes auto-capture far less finicky.
            stableRef.current = steady ? stableRef.current + 1 : Math.max(0, stableRef.current - 2);
            contentTicksRef.current = contentOk ? contentTicksRef.current + 1 : 0;
            // Always show feedback while a card is framed (amber), even while zooming
            // or during the grace window, so the status colour is visible.
            if (!lockingRef.current) setAiming(contentOk);

            // Grace window: give the user time to zoom/compose. No auto-capture until
            // a card has been in view for GRACE ticks since opening / the last touch
            // or zoom (both reset contentTicksRef), so it can't fire before they aim.
            const GRACE = 12; // ~2.4s
            const settled = contentTicksRef.current >= GRACE;
            setProgress(settled ? Math.min(1, stableRef.current / STEADY_NEED) : 0);

            const readyToFire = settled && stableRef.current >= STEADY_NEED;
            // Later fallbacks so a zoomed/shaky-but-aimed card still eventually fires:
            const longAimed = contentTicksRef.current >= 24;  // ~4.8s on a card
            const veryLong = contentTicksRef.current >= 42;   // ~8.4s — give up waiting for sharp
            setFocusing((readyToFire || longAimed) && !focused);
            if (!lockingRef.current && ((readyToFire && focused) || (longAimed && focused) || veryLong)) {
                // Lock: show the green confirm briefly so the user SEES it before the
                // shot is taken, then capture.
                lockingRef.current = true;
                if (timer) { clearInterval(timer); timer = null; }
                setLocked(true);
                setAiming(false);
                setProgress(1);
                setFocusing(false);
                lockTimer = setTimeout(() => doCapture(), 650);
            }
        };

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                    audio: false,
                });
                if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                // Best-effort: ask the camera for continuous autofocus so the card
                // (and its tiny number) lands in focus before we capture.
                try {
                    const track = stream.getVideoTracks()[0];
                    // focusMode isn't in the standard TS types yet
                    await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints);
                } catch { /* not supported — rely on the sharpness gate */ }
                try {
                    // Hardware zoom (real optical/digital sensor zoom → keeps detail,
                    // makes the tiny card number readable). Only some cameras expose it.
                    const track = stream.getVideoTracks()[0];
                    const caps = (track.getCapabilities?.() || {}) as unknown as { zoom?: { min: number; max: number; step?: number } };
                    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
                        zoomRef.current = caps.zoom.min || 1;
                        setZoom(zoomRef.current);
                        setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
                    }
                } catch { /* no zoom support */ }
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { });
                    setReady(true);
                    setTimeout(() => { if (!cancelled) timer = setInterval(tick, 200); }, 400);
                }
            } catch {
                setError('Không mở được camera. Hãy cấp quyền camera, hoặc dùng "Chọn ảnh từ thiết bị".');
            }
        })();

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            if (lockTimer) clearTimeout(lockTimer);
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [open]);

    const toggleAuto = () => {
        const v = !autoOn;
        setAutoOn(v); autoRef.current = v;
        stableRef.current = 0; setProgress(0); setFocusing(false);
    };

    const applyZoom = (z: number) => {
        if (!zoomCaps) return;
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return;
        const nz = Math.min(zoomCaps.max, Math.max(zoomCaps.min, z));
        zoomRef.current = nz;
        setZoom(nz);
        track.applyConstraints({ advanced: [{ zoom: nz }] } as unknown as MediaTrackConstraints).catch(() => { });
        // Zooming changes the view: don't auto-capture mid-zoom, and re-baseline
        // the focus peak / aim timer so the new zoom level can settle.
        stableRef.current = 0;
        sharpPeakRef.current = 0;
        contentTicksRef.current = 0;
    };

    const dist2 = (t: React.TouchList | TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: React.TouchEvent) => {
        // Any touch means the user is still composing → push back auto-capture.
        stableRef.current = 0; contentTicksRef.current = 0;
        if (e.touches.length === 2 && zoomCaps) pinchRef.current = { dist: dist2(e.touches), zoom: zoomRef.current };
    };
    const onTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && pinchRef.current) {
            const ratio = dist2(e.touches) / pinchRef.current.dist;
            applyZoom(pinchRef.current.zoom * ratio);
        }
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        if (e.touches.length < 2) pinchRef.current = null;
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black flex flex-col">
            <div className="flex items-center justify-between p-4 text-white">
                <button
                    onClick={toggleAuto}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${autoOn ? "bg-orange-500/20 border-orange-500/40 text-orange-300" : "border-white/20 text-white/60"}`}
                >
                    <Lightning className="w-4 h-4" weight={autoOn ? "fill" : "regular"} />
                    Auto {autoOn ? "BẬT" : "TẮT"}
                </button>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Đóng">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div
                className="relative flex-1 overflow-hidden"
                style={{ touchAction: "none" }}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
            >
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

                {/* Alignment frame + scan beam + dimmed surroundings */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                        ref={frameRef}
                        className="relative w-[80%] max-w-[340px] aspect-[3/4] rounded-2xl transition-[outline] duration-150"
                        style={{
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                            outline: locked
                                ? "5px solid rgba(34,197,94,1)"               // green: locked → capturing
                                : aiming
                                    ? "3px solid rgba(250,204,21,0.9)"        // amber: card framed / aiming
                                    : "none",
                        }}
                    >
                        <span className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-orange-400 rounded-tl-2xl" />
                        <span className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-orange-400 rounded-tr-2xl" />
                        <span className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-orange-400 rounded-bl-2xl" />
                        <span className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-orange-400 rounded-br-2xl" />
                        {ready && <div className="scan-beam rounded-2xl" />}
                    </div>
                </div>

                {!ready && !error && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <SpinnerGap className="w-8 h-8 animate-spin text-orange-400" weight="bold" />
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80 bg-black/80">
                        {error}
                    </div>
                )}

                {/* Zoom slider (camera hardware zoom) — pinch-to-zoom also works */}
                {ready && zoomCaps && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/55 backdrop-blur rounded-full px-4 py-2">
                        <span className="text-[11px] text-white/70 font-semibold w-9 text-right">{zoom.toFixed(1)}×</span>
                        <input
                            type="range"
                            min={zoomCaps.min}
                            max={zoomCaps.max}
                            step={zoomCaps.step}
                            value={zoom}
                            onChange={(e) => applyZoom(parseFloat(e.target.value))}
                            className="w-44 accent-orange-500"
                            aria-label="Zoom"
                        />
                    </div>
                )}
            </div>

            <div className="p-6 flex flex-col items-center gap-3">
                <button
                    onClick={doCapture}
                    disabled={!ready}
                    className="w-16 h-16 rounded-full bg-orange-500 hover:bg-orange-600 ring-4 ring-white/20 flex items-center justify-center shadow-[0_0_25px_rgba(249,115,22,0.6)] active:scale-95 transition disabled:opacity-40"
                    aria-label="Chụp"
                >
                    <Camera className="w-7 h-7 text-white" weight="fill" />
                </button>
                <p className="text-xs text-white/45 text-center max-w-[260px]">
                    {autoOn
                        ? (locked ? "✓ Đã khóa — đang chụp"
                            : focusing ? "Đang lấy nét… giữ yên cho rõ số thẻ"
                                : progress > 0 ? "Ổn định… chuẩn bị chụp"
                                    : "Trùm khung lên thẻ (thật hoặc trên màn hình) — máy tự chụp")
                        : "Trùm khung lên thẻ rồi bấm để quét"}
                </p>
            </div>
        </div>
    );
}
