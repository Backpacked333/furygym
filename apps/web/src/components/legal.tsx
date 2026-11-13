import Link from "next/link";
import type { ReactNode } from "react";
import { createPublicClient } from "@/lib/supabase/server";

/** The gym's name with its privacy, terms and support text. Readable signed out: Apple and Stripe link to these pages. */
export async function getLegal() {
  const supabase = createPublicClient();
  const { data: gym } = await supabase.from("gyms").select("id, name").eq("is_default", true).maybeSingle();
  const { data: legal } = gym ? await supabase.from("gym_legal").select("support_email, privacy_policy, terms, updated_at").eq("gym_id", gym.id).maybeSingle() : { data: null };
  return { gymName: gym?.name ?? "Fury Co. Athletics", legal };
}

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted ${className}`}>
      <Link href="/privacy" className="hover:underline">Privacy</Link>
      <Link href="/terms" className="hover:underline">Terms</Link>
      <Link href="/support" className="hover:underline">Support</Link>
    </nav>
  );
}

export function LegalPage({ gymName, title, updatedAt, children }: { gymName: string; title: string; updatedAt?: string | null; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent"><Link href="/">{gymName}</Link></p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      {updatedAt ? <p className="mt-2 text-[13px] text-muted">Last updated {new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(updatedAt))}</p> : null}
      <div className="mt-8 whitespace-pre-wrap text-[15px] leading-7">{children}</div>
      <LegalLinks className="mt-14 border-t border-line pt-6" />
    </main>
  );
}

/** Shown until the gym's own wording is entered in Plans & settings. */
export function LegalPending({ what, email }: { what: string; email?: string | null }) {
  return (
    <p className="text-muted">
      {what} is being finalised and will be published here.{" "}
      {email ? <>For questions in the meantime, email <a className="text-ink underline" href={`mailto:${email}`}>{email}</a>.</> : "For questions in the meantime, ask at the front desk."}
    </p>
  );
}
