import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const buttonVariants = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-line bg-raised text-ink hover:border-muted",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger: "border border-bad/50 text-bad hover:bg-bad/10",
};
export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "secondary", small = false): string {
  return cx(buttonBase, buttonVariants[variant], small && "px-2 py-1 text-xs");
}

export function Button({ variant = "secondary", small, className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; small?: boolean }) {
  return <button className={cx(buttonClass(variant, small), className)} {...props} />;
}

export function LinkButton({ variant = "secondary", small, className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; small?: boolean }) {
  return <Link className={cx(buttonClass(variant, small), className)} {...props} />;
}

export const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
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
  neutral: "border-line bg-raised text-muted",
  good: "border-good/40 bg-good/10 text-good",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  accent: "border-accent/40 bg-accent/10 text-accent",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cx("px-3 py-2 align-middle", className)} {...props} />;
}

export function TrackDot({ color }: { color?: string | null }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color ?? "#666" }} />;
}

const membershipTones: Record<string, Tone> = {
  active: "good", past_due: "warn", frozen: "neutral", cancelled: "bad", expired: "bad",
  booked: "good", waitlisted: "warn", attended: "good", no_show: "bad",
  succeeded: "good", failed: "bad", refunded: "neutral", partially_refunded: "warn", pending: "warn",
  published: "good", draft: "neutral", archived: "neutral", paused: "neutral", completed: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={membershipTones[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
