"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, SpinnerGap, Lightning } from "@phosphor-icons/react";

/**
 * Live camera scanner that AUTO-DETECTS the card in view and captures it — no
 * need to line the card up inside a fixed frame.
 *
 * How: a few times a second we downscale the whole frame, build a coarse
 * "detail map" (per-cell luminance variance), and take the bounding box of the
 * detailed area (the card stands out from a plainer background). A live box
 * snaps to it; once that box is steady for a moment we crop to it and capture.
 * Pure-JS heuristic (no CV library). Manual shutter + Auto toggle remain.
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
    const streamRef = useRef<MediaStream | null>(null);
    const capturedRef = useRef(false);
    const autoRef = useRef(true);
    const prevBoxRef = useRef<[number, number, number, number] | null>(null); // normalized x0,y0,x1,y1
    const lastBoxRef = useRef<[number, number, number, number] | null>(null);
    const stableRef = useRef(0);

    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [autoOn, setAutoOn] = useState(true);
    const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [locking, setLocking] = useState(false);

    const STEADY_NEED = 3; // steady detections (~0.6s) before auto-fire
    const GC = 16, GR = 12; // detail grid

    // object-cover mapping helpers (normalized video coords <-> displayed px)
    const coverParams = () => {
        const video = videoRef.current!;
        const rect = video.getBoundingClientRect();
        const vW = video.videoWidth, vH = video.videoHeight;
        const scale = Math.max(rect.width / vW, rect.height / vH);
        return { rect, vW, vH, scale, dispW: vW * scale, dispH: vH * scale };
    };

    const cropToBox = (b: [number, number, number, number]) => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;
        const vW = video.videoWidth, vH = video.videoHeight;
        // pad a little so we don't clip the card edge
        const pad = 0.04;
        const x0 = Math.max(0, b[0] - pad), y0 = Math.max(0, b[1] - pad);
        const x1 = Math.min(1, b[2] + pad), y1 = Math.min(1, b[3] + pad);
        const sx = x0 * vW, sy = y0 * vH, sw = (x1 - x0) * vW, sh = (y1 - y0) * vH;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw));
        canvas.height = Math.max(1, Math.round(sh));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    };

    const doCapture = () => {
        if (capturedRef.current) return;
        const b = lastBoxRef.current || [0.1, 0.1, 0.9, 0.9];
        const data = cropToBox(b);
        if (!data) return;
        capturedRef.current = true;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCapture(data);
    };

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        const a = document.createElement("canvas");
        const actx = a.getContext("2d", { willReadFrequently: true });

        capturedRef.current = false;
        prevBoxRef.current = null;
        lastBoxRef.current = null;
        stableRef.current = 0;
        setError(null); setReady(false); setBox(null); setLocking(false);

        const tick = () => {
            const video = videoRef.current;
            if (!video || !video.videoWidth || !actx) return;
            const vW = video.videoWidth, vH = video.videoHeight;
            const AW = 96, AH = Math.max(48, Math.round(AW * vH / vW));
            a.width = AW; a.height = AH;
            actx.drawImage(video, 0, 0, AW, AH);
            const px = actx.getImageData(0, 0, AW, AH).data;

            // luminance
            const lum = new Float32Array(AW * AH);
            for (let i = 0, j = 0; i < px.length; i += 4, j++) {
                lum[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            }
            // per-cell variance → detail map
            const cellW = AW / GC, cellH = AH / GR;
            let minC = GC, minR = GR, maxC = -1, maxR = -1, active = 0;
            for (let r = 0; r < GR; r++) {
                for (let c = 0; c < GC; c++) {
                    const x0 = Math.floor(c * cellW), x1 = Math.floor((c + 1) * cellW);
                    const y0 = Math.floor(r * cellH), y1 = Math.floor((r + 1) * cellH);
                    let s = 0, n = 0;
                    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * AW + x]; n++; }
                    const m = s / Math.max(1, n);
                    let v = 0;
                    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const d = lum[y * AW + x] - m; v += d * d; }
                    v /= Math.max(1, n);
                    if (v > 130) { // detailed cell
                        active++;
                        if (c < minC) minC = c; if (c > maxC) maxC = c;
                        if (r < minR) minR = r; if (r > maxR) maxR = r;
                    }
                }
            }

            const frac = active / (GC * GR);
            // need some content, but not the entire view (busy background)
            if (maxC < 0 || frac < 0.05 || frac > 0.92) {
                stableRef.current = 0; setLocking(false); setBox(null);
                prevBoxRef.current = null;
                return;
            }

            // normalized bbox (expand cells to edges)
            const nb: [number, number, number, number] = [
                minC / GC, minR / GR, (maxC + 1) / GC, (maxR + 1) / GR,
            ];
            lastBoxRef.current = nb;

            // draw box in displayed px
            const { rect, dispW, dispH, vW: dvW, vH: dvH } = coverParams();
            const offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
            setBox({
                left: offX + nb[0] * dispW,
                top: offY + nb[1] * dispH,
                width: (nb[2] - nb[0]) * dispW,
                height: (nb[3] - nb[1]) * dispH,
            });
            void dvW; void dvH;

            // stability vs previous box
            const prev = prevBoxRef.current;
            const close = prev && Math.abs(nb[0] - prev[0]) < 0.08 && Math.abs(nb[1] - prev[1]) < 0.08
                && Math.abs(nb[2] - prev[2]) < 0.08 && Math.abs(nb[3] - prev[3]) < 0.08;
            prevBoxRef.current = nb;

            if (autoRef.current && close) {
                stableRef.current++;
                setLocking(true);
                if (stableRef.current >= STEADY_NEED) {
                    if (timer) { clearInterval(timer); timer = null; }
                    doCapture();
                }
            } else {
                stableRef.current = 0; setLocking(false);
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
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { });
                    setReady(true);
                    setTimeout(() => { if (!cancelled) timer = setInterval(tick, 200); }, 300);
                }
            } catch {
                setError('Không mở được camera. Hãy cấp quyền camera, hoặc dùng "Chọn ảnh từ thiết bị".');
            }
        })();

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [open]);

    const toggleAuto = () => {
        const v = !autoOn;
        setAutoOn(v); autoRef.current = v;
        stableRef.current = 0; setLocking(false);
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

            <div className="relative flex-1 overflow-hidden">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

                {/* Dynamic detection box that snaps to the card */}
                {box && (
                    <div
                        className="absolute rounded-lg pointer-events-none transition-all duration-150"
                        style={{
                            left: box.left, top: box.top, width: box.width, height: box.height,
                            border: `3px solid ${locking ? "#22c55e" : "#fb923c"}`,
                            boxShadow: `0 0 18px ${locking ? "rgba(34,197,94,0.6)" : "rgba(251,146,60,0.5)"}`,
                        }}
                    />
                )}

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
                <p className="text-xs text-white/45">
                    {autoOn
                        ? (locking ? "Đã thấy thẻ — đang chụp…" : "Hướng camera vào thẻ — máy tự nhận & chụp")
                        : "Hướng vào thẻ rồi bấm để quét"}
                </p>
            </div>
        </div>
    );
}
