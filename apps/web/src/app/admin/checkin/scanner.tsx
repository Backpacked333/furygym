"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { scanCode, type ScanResult } from "./actions";

/**
 * Front-desk check-in. A handheld scanner types the athlete's code into the field and presses
 * Enter; browsers that can read QR codes from the camera can use that instead.
 */
export function Scanner({ timeZone }: { timeZone: string }) {
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [camera, setCamera] = useState<"off" | "on" | "unsupported">("off");
  const last = useRef("");

  const submit = async (payload: string) => {
    const code = payload.trim();
    if (!code || busy) return;
    setBusy(true);
    setResult(await scanCode(code));
    setValue("");
    setBusy(false);
    input.current?.focus();
  };

  useEffect(() => {
    if (camera !== "on") return;
    type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const detector = new Ctor({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        timer = setInterval(async () => {
          if (!video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          const raw = codes[0]?.rawValue;
          // The same code stays in view for a moment; only act on a new one.
          if (raw && raw !== last.current) {
            last.current = raw;
            void submit(raw);
          }
        }, 500);
      })
      .catch(() => setCamera("unsupported"));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "");
  const good = result?.result === "checked_in" || result?.result === "already_checked_in";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-[26px] bg-surface p-5">
        <h2 className="text-[17px] font-semibold">Scan a code</h2>
        <p className="mt-1 text-sm text-muted">Athletes open the red check-in button in the app. Keep this field selected and scan.</p>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(value);
          }}
        >
          <input
            ref={input}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Check-in code"
            placeholder="Waiting for a scan…"
            autoComplete="off"
            className="w-full rounded-2xl bg-raised px-4 py-3 font-mono text-[15px] outline-none focus:shadow-[0_0_0_2px_var(--color-accent)]"
          />
        </form>
        <div className="mt-4">
          {camera === "on" ? (
            <video ref={video} muted playsInline className="aspect-video w-full rounded-2xl bg-black object-cover" />
          ) : (
            <button
              type="button"
              // Camera scanning needs the browser's built-in QR reader; where it is missing, say so.
              onClick={() => setCamera("BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia) ? "on" : "unsupported")}
              disabled={camera === "unsupported"} className="inline-flex h-9 items-center gap-2 rounded-full bg-fill px-4 text-[15px] font-semibold disabled:opacity-40">
              <Icon name="qr" size={18} />
              {camera === "unsupported" ? "Camera scanning is not available in this browser" : "Use this device’s camera"}
            </button>
          )}
        </div>
      </section>

      <section
        role="status"
        aria-live="polite"
        className={cx("flex min-h-64 flex-col items-center justify-center rounded-[26px] p-8 text-center", !result ? "bg-surface" : good ? "bg-good/15" : "bg-warn/15")}
      >
        {!result ? (
          <p className="text-muted">{busy ? "Checking…" : "The result of each scan appears here."}</p>
        ) : (
          <>
            <p className={cx("text-xs font-bold uppercase tracking-[1.2px]", good ? "text-good" : "text-warn")}>
              {{ checked_in: "Checked in", already_checked_in: "Already checked in", no_booking: "No class booked", expired_code: "Code expired", invalid_code: "Not a Fury Co. code", error: "Could not check in" }[result.result]}
            </p>
            <p className="mt-2 text-[40px] font-extrabold leading-tight tracking-[-1px]">{result.athlete ?? "—"}</p>
            <p className="mt-1 text-muted">
              {result.class ? `${result.class} · ${time(result.starts_at)}` : result.result === "no_booking" ? "Add them to a class from its roster." : result.result === "expired_code" ? "Ask the athlete to reopen the check-in screen." : (result.message ?? "")}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
