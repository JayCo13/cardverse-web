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

    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [autoOn, setAutoOn] = useState(true);
    const [progress, setProgress] = useState(0); // 0..1 stabilization

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
        const sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = 32; sampleCanvas.height = 42;
        const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });

        capturedRef.current = false;
        prevSampleRef.current = null;
        stableRef.current = 0;
        setError(null); setReady(false); setProgress(0);

        const tick = () => {
            if (!autoRef.current || capturedRef.current || !sctx) return;
            const crop = computeCrop();
            const video = videoRef.current;
            if (!crop || !video) return;
            sctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 32, 42);
            const data = sctx.getImageData(0, 0, 32, 42).data;
            const lum = new Float32Array(32 * 42);
            let sum = 0;
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                lum[j] = l; sum += l;
            }
            const mean = sum / lum.length;
            let variance = 0;
            for (let j = 0; j < lum.length; j++) variance += (lum[j] - mean) * (lum[j] - mean);
            variance /= lum.length;

            const prev = prevSampleRef.current;
            let diff = Infinity;
            if (prev) {
                let d = 0;
                for (let j = 0; j < lum.length; j++) d += Math.abs(lum[j] - prev[j]);
                diff = d / lum.length;
            }
            prevSampleRef.current = lum;

            // Enough detail (a card, not blank/dark) AND roughly steady. The diff
            // threshold is generous so normal hand-shake still counts as steady.
            const contentOk = variance > 130 && mean > 20 && mean < 245;
            const steady = prev !== null && diff < 13 && contentOk;
            stableRef.current = steady ? stableRef.current + 1 : 0;
            setProgress(Math.min(1, stableRef.current / STEADY_NEED));

            if (stableRef.current >= STEADY_NEED) {
                if (timer) { clearInterval(timer); timer = null; }
                doCapture();
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
                    setTimeout(() => { if (!cancelled) timer = setInterval(tick, 200); }, 400);
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
        stableRef.current = 0; setProgress(0);
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

                {/* Alignment frame + scan beam + dimmed surroundings */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                        ref={frameRef}
                        className="relative w-[80%] max-w-[340px] aspect-[3/4] rounded-2xl transition-[outline] duration-150"
                        style={{
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                            outline: progress > 0 ? `3px solid rgba(34,197,94,${0.35 + progress * 0.65})` : "none",
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
                        ? (progress > 0 ? "Giữ yên… đang chụp" : "Trùm khung lên thẻ (thật hoặc trên màn hình) — máy tự chụp")
                        : "Trùm khung lên thẻ rồi bấm để quét"}
                </p>
            </div>
        </div>
    );
}
