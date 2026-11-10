import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The red rounded-square "F" app mark. */
export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="brand inline-flex shrink-0 items-center justify-center text-white"
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.27), fontSize: Math.round(size * 0.6), lineHeight: 1,
        background: "linear-gradient(160deg, #ff4b4e 0%, #c8102e 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 6px rgba(0,0,0,0.25)",
      }}
    >
      F
    </span>
  );
}

/** "FURY CO. ATHLETICS" wordmark. */
export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline" style={{ gap: Math.round(size * 0.35) }}>
      <span className="brand text-white" style={{ fontSize: size, lineHeight: 1 }}>Fury&nbsp;Co.</span>
      <span className="font-bold uppercase text-accent" style={{ fontSize: Math.round(size * 0.5), lineHeight: 1, letterSpacing: `${(size * 0.12).toFixed(1)}px` }}>Athletics</span>
    </span>
  );
}

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[13px] text-muted">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-bold leading-[34px] tracking-[0.3px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[26px] bg-surface p-5", className)}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-[-0.3px]">{title}</h2>
          {actions ? <div className="flex items-center gap-2 text-sm">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap";
const buttonVariants = {
  primary: "btn-filled text-white hover:brightness-110",
  secondary: "bg-fill text-white hover:bg-high",
  ghost: "text-muted hover:bg-fill hover:text-ink",
  danger: "bg-fill text-accent hover:bg-high",
  tinted: "bg-accent/15 text-accent-hi hover:bg-accent/25",
};
export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "secondary", small = false): string {
  return cx(buttonBase, buttonVariants[variant], small ? "h-7 px-3 text-[13px]" : "h-9 px-4 text-[15px]");
}

export function Button({ variant = "secondary", small, className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; small?: boolean }) {
  return <button className={cx(buttonClass(variant, small), className)} {...props} />;
}

export function LinkButton({ variant = "secondary", small, className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; small?: boolean }) {
  return <Link className={cx(buttonClass(variant, small), className)} {...props} />;
}

export const inputClass =
  "w-full rounded-2xl bg-raised px-4 py-2.5 text-[15px] text-ink placeholder:text-faint outline-none ring-0 focus:shadow-[0_0_0_2px_var(--color-accent)]";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block pl-1 text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block pl-1 text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputClass, "min-h-20", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputClass, className)} {...props} />;
}

const tones = {
  neutral: "bg-fill text-muted",
  good: "bg-good/[0.18] text-good",
  warn: "bg-warn/[0.18] text-warn",
  bad: "bg-bad/[0.18] text-bad",
  accent: "bg-accent/[0.18] text-accent",
  gold: "bg-gold/[0.18] text-gold",
  indigo: "bg-indigo/[0.18] text-indigo",
};
export type Tone = keyof typeof tones;

/** A small pill label: status, track or count. */
export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", tones[tone])}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** A track pill in the track's own colour. */
export function TrackChip({ name, color }: { name?: string | null; color?: string | null }) {
  const c = color ?? "#8e8e93";
  return (
    <span className="inline-flex h-6 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold" style={{ color: c, background: `color-mix(in srgb, ${c} 18%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {name ?? "No track"}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "accent" | "good" | "warn" }) {
  return (
    <div className="rounded-[26px] bg-surface p-5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cx("mt-1 text-[34px] font-extrabold leading-[38px] tracking-[-0.8px] tabular-nums", tone === "accent" && "text-accent", tone === "good" && "text-good", tone === "warn" && "text-warn")}>{value}</div>
      {hint ? <div className="mt-1.5 text-[13px] text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-fill-soft px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <thead>
          <tr className="border-b border-line text-xs font-semibold uppercase tracking-[0.4px] text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-1 pb-2.5 font-semibold first:pl-0 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cx("px-1 py-3 align-middle first:pl-0 last:pr-0", className)} {...props} />;
}

export function TrackDot({ color }: { color?: string | null }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color ?? "#8e8e93" }} />;
}

/** The coloured bar at the left edge of a class or workout row. */
export function TrackBar({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cx("inline-block w-[3px] shrink-0 self-stretch rounded-full", className)} style={{ background: color ?? "#8e8e93" }} />;
}

export function Avatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-high font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
  );
}

/** Seats taken out of capacity; turns orange when full. */
export function CapacityBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, (booked / capacity) * 100) : 0;
  const full = booked >= capacity;
  return (
    <span className="inline-flex items-center gap-2.5 tabular-nums">
      <span className="h-1 w-11 overflow-hidden rounded-full bg-fill"><span className={cx("block h-full rounded-full", full ? "bg-warn" : "bg-white/80")} style={{ width: `${pct}%` }} /></span>
      <span className={full ? "text-warn" : undefined}>{booked}/{capacity}</span>
    </span>
  );
}

/** Pill-shaped filter/segment links. */
export function Segmented({ options, active }: { options: { label: string; href: string }[]; active: string }) {
  return (
    <div className="inline-flex h-9 rounded-full bg-fill p-0.5">
      {options.map((o) => (
        <Link key={o.href} href={o.href} className={cx("inline-flex items-center rounded-full px-4 text-[13px] font-semibold", o.label === active ? "bg-white/20 text-white shadow-[0_3px_8px_rgba(0,0,0,0.18)]" : "text-white/90")}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

const statusTones: Record<string, Tone> = {
  active: "good", past_due: "warn", frozen: "indigo", cancelled: "neutral", expired: "neutral",
  booked: "neutral", waitlisted: "warn", attended: "good", no_show: "bad",
  succeeded: "good", failed: "bad", refunded: "neutral", partially_refunded: "warn", pending: "warn",
  published: "good", draft: "neutral", archived: "neutral", paused: "neutral", completed: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTones[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
