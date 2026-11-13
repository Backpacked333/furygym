import Link from "next/link";
import { redirect } from "next/navigation";
import { LegalLinks } from "@/components/legal";
import { LinkButton, TrackDot } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { money } from "@/lib/format";
import { createPublicClient } from "@/lib/supabase/server";

export default async function Home() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.isStaff ? "/admin" : "/account");

  const supabase = createPublicClient();
  const [{ data: plans }, { data: programs }] = await Promise.all([
    supabase.from("membership_plans").select("id, name, description, price_cents, currency, billing_interval").order("position"),
    supabase.from("programs").select("id, name, slug, summary, duration_weeks, days_per_week, price_cents, currency, tracks(name, color)").order("position"),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Train with Fury Co.</h1>
      <p className="mt-3 max-w-xl text-muted">Coached classes at the gym and structured programs you can follow anywhere. Get the Fury Co. app to book classes, see your training and log every session.</p>
      <div className="mt-6 flex gap-3">
        <LinkButton href="/join" variant="primary">Create an account</LinkButton>
        <LinkButton href="/login">Sign in</LinkButton>
      </div>

      <h2 className="mt-14 text-lg font-semibold">Online programs</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(programs ?? []).map((p) => (
          <Link key={p.id} href={`/programs/${p.slug}`} className="rounded-[26px] bg-surface p-5 hover:bg-raised">
            <p className="flex items-center gap-2 text-xs text-muted"><TrackDot color={p.tracks?.color} />{p.tracks?.name}</p>
            <p className="mt-1 text-lg font-semibold">{p.name}</p>
            <p className="mt-1 text-sm text-muted">{p.summary}</p>
            <p className="mt-3 text-sm">{p.duration_weeks} weeks · {p.days_per_week} sessions a week · <span className="font-semibold">{money(p.price_cents, p.currency)}</span></p>
          </Link>
        ))}
        {programs?.length ? null : <p className="text-sm text-muted">Programs are coming soon.</p>}
      </div>

      <h2 className="mt-14 text-lg font-semibold">Gym memberships</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(plans ?? []).map((p) => (
          <div key={p.id} className="rounded-[26px] bg-surface p-5">
            <p className="font-semibold">{p.name}</p>
            <p className="mt-1 text-sm text-muted">{p.description}</p>
            <p className="mt-3 text-sm font-semibold">{money(p.price_cents, p.currency)}{p.billing_interval ? ` / ${p.billing_interval}` : ""}</p>
          </div>
        ))}
        {plans?.length ? null : <p className="text-sm text-muted">Membership options will be listed here soon.</p>}
      </div>
      <LegalLinks className="mt-16 border-t border-line pt-6" />
    </main>
  );
}
