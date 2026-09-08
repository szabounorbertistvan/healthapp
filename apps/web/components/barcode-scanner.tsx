"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

// Barcode scanning with two decoders.
//
// BarcodeDetector is native and free where it exists — Chromium on desktop and
// Android. It does NOT exist on iOS Safari, Firefox, or Electron shells, which
// between them are most of a gym. So ZXing is loaded as a fallback, but only
// when the native API is missing and only at the moment someone scans: it is a
// dynamic import, so it never reaches anyone who does not open the camera.
//
// Manual entry stays available on every path. A scan must not be the only way
// in (PRODUCT_SPEC C3).

type Detected = { rawValue: string };
type DetectorLike = { detect: (source: CanvasImageSource) => Promise<Detected[]> };

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): DetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

type Status = "starting" | "scanning" | "denied" | "no-camera" | "error";

export function BarcodeScanner({
  onCode,
  onCancel,
  busy = false,
}: {
  onCode: (code: string) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState<Status>("starting");
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [manual, setManual] = useState("");

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Held in a ref so `accept` — and therefore the camera effect below — keeps a
  // stable identity. FoodLogger passes an inline arrow, so depending on the prop
  // directly would tear down and re-acquire the stream on every parent render,
  // including the one that fires the moment a code is handed over.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const accept = useCallback(
    (code: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stop();
      onCodeRef.current(code);
    },
    [stop],
  );

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (doneRef.current) return; // a code was already accepted
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("no-camera");
        return;
      }

      // Camera first, so a permission prompt appears before any decoder work.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        if (cancelled) return;
        setStatus(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "no-camera"
              : "error",
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // autoplay refusal — the frame loop still reads from the element
      }
      if (cancelled) return;
      setStatus("scanning");

      if (typeof window !== "undefined" && window.BarcodeDetector) {
        setEngine("native");
        runNative();
      } else {
        setEngine("zxing");
        await runZxing(stream);
      }
    }

    function runNative() {
      let detector: DetectorLike;
      try {
        detector = new window.BarcodeDetector!({ formats: NATIVE_FORMATS });
      } catch {
        setStatus("error");
        return;
      }
      const tick = async () => {
        const video = videoRef.current;
        if (cancelled || doneRef.current) return;
        if (video && video.readyState >= 2) {
          try {
            const hits = await detector.detect(video);
            const code = hits.find((h) => /^\d{6,14}$/.test(h.rawValue))?.rawValue;
            if (code) {
              accept(code);
              return;
            }
          } catch {
            // a single bad frame is normal
          }
        }
        if (!cancelled && !doneRef.current) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    async function runZxing(stream: MediaStream) {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || doneRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const video = videoRef.current;
        if (!video) return;
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!result || doneRef.current) return;
          const text = result.getText().trim();
          if (/^\d{6,14}$/.test(text)) accept(text);
        });
        if (cancelled || doneRef.current) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [accept, stop]);

  const submitManual = () => {
    const clean = manual.trim();
    if (/^\d{6,14}$/.test(clean)) accept(clean);
  };

  const liveCamera = status === "starting" || status === "scanning";

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientWidgets.barcodeScanner.title}
        </p>
        <button
          type="button"
          onClick={() => {
            stop();
            onCancel();
          }}
          className="text-xs font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.close}
        </button>
      </div>

      {liveCamera ? (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-56 w-full object-cover"
            aria-label={t.clientWidgets.barcodeScanner.cameraPreview}
          />
          {/* A barcode is wide and short — frame it that way. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-4/5 rounded-md border-2 border-accent/80" />
          </div>
          <p className="absolute inset-x-0 bottom-1 text-center text-[11px] text-white/90">
            {busy
              ? t.clientWidgets.barcodeScanner.lookingUp
              : status === "starting"
                ? t.clientWidgets.barcodeScanner.startingCamera
                : t.clientWidgets.barcodeScanner.holdInFrame}
          </p>
          {engine === "zxing" && status === "scanning" ? (
            <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70">
              {t.clientWidgets.barcodeScanner.compatDecoder}
            </span>
          ) : null}
        </div>
      ) : null}

      {status === "denied" ? (
        <p className="text-xs leading-snug text-warn">{t.clientWidgets.barcodeScanner.denied}</p>
      ) : null}
      {status === "no-camera" ? (
        <p className="text-xs leading-snug text-ink-soft">{t.clientWidgets.barcodeScanner.noCamera}</p>
      ) : null}
      {status === "error" ? (
        <p className="text-xs leading-snug text-warn">{t.clientWidgets.barcodeScanner.error}</p>
      ) : null}

      <div className="mt-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.barcodeScanner.orTypeNumber}
          </span>
          <input
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
            placeholder="5941234567890"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={busy || !/^\d{6,14}$/.test(manual.trim())}
          onClick={submitManual}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {t.clientWidgets.barcodeScanner.lookUp}
        </button>
      </div>
    </div>
  );
}
