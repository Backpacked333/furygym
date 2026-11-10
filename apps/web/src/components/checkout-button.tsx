"use client";

import { useState } from "react";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** Starts Stripe Checkout (or the billing portal) and sends the browser there. */
export function CheckoutButton({ endpoint = "/api/stripe/checkout", body, children, variant = "primary" }: { endpoint?: string; body: Record<string, unknown>; children: React.ReactNode; variant?: ButtonVariant }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.message ?? (data.error === "not_authenticated" ? "Sign in first." : "Something went wrong. Please try again."));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={go} disabled={busy} className={buttonClass(variant)}>{busy ? "One moment…" : children}</button>
      {error ? <span role="alert" className="max-w-xs text-xs text-bad">{error}</span> : null}
    </span>
  );
}

/** Start-date picker + buy button for an online program. */
export function ProgramPurchase({ programId, today, maxDate, priceLabel }: { programId: string; today: string; maxDate: string; priceLabel: string }) {
  const [start, setStart] = useState(today);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Your start date</span>
        <input type="date" value={start} min={today} max={maxDate} onChange={(e) => setStart(e.target.value)} className="rounded-2xl bg-raised px-4 py-2.5 text-[15px] outline-none focus:shadow-[0_0_0_2px_var(--color-accent)]" />
        <span className="mt-1 block text-xs text-muted">Day 1 of your calendar. You can change it any time before the program begins.</span>
      </label>
      <CheckoutButton body={{ kind: "program", id: programId, start_date: start }}>Enrol — {priceLabel}</CheckoutButton>
    </div>
  );
}
