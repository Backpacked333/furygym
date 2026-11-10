import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Empty, Field, Input, LinkButton, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime, money, todayInZone } from "@/lib/format";
import { changeStartDate, signWaiver } from "./actions";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const { supabase, user, gym, profile, isStaff } = await requireUser();
  const today = todayInZone(gym.timezone);

  const [{ data: waivers }, { data: signatures }, { data: memberships }, { data: enrollments }, { data: plans }, { data: programs }, { data: customer }] = await Promise.all([
    supabase.from("waivers").select("*").eq("active", true).eq("required", true),
    supabase.from("waiver_signatures").select("waiver_id").eq("user_id", user.id),
    supabase.from("memberships").select("*, membership_plans(name, kind)").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("enrollments").select("*, programs(name, slug, duration_weeks)").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("membership_plans").select("*").eq("active", true).eq("is_public", true).order("position"),
    supabase.from("programs").select("id, name, slug, summary, price_cents, currency").eq("status", "published").order("position"),
    supabase.from("stripe_customers").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const signed = new Set((signatures ?? []).map((s) => s.waiver_id));
  const unsigned = (waivers ?? []).filter((w) => !signed.has(w.id));
  const current = (memberships ?? []).filter((m) => ["active", "past_due", "frozen"].includes(m.status));
  const hasRecurring = current.some((m) => m.membership_plans?.kind === "recurring");
  const enrolledIds = new Set((enrollments ?? []).filter((e) => e.status === "active").map((e) => e.program_id));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">{gym.name}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{profile?.full_name || user.email}</h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <div className="flex gap-2">
          {isStaff ? <LinkButton href="/admin">Staff console</LinkButton> : null}
          <form action="/auth/signout" method="post"><button className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">Sign out</button></form>
        </div>
      </header>

      <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
        Training happens in the Fury Co. app: your calendar, workout logging, class booking and progress. This page is for your membership, programs and billing.
      </p>

      {unsigned.map((waiver) => (
        <Card key={waiver.id} title={`Please sign: ${waiver.title}`}>
          <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-2xl bg-raised p-3.5 text-sm text-muted">{waiver.body}</div>
          <ActionForm action={signWaiver} className="mt-4 space-y-3">
            <input type="hidden" name="waiver_id" value={waiver.id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" className="mt-1" required /> I have read and agree to the above.</label>
            <Field label="Type your full legal name to sign"><Input name="signed_name" autoComplete="name" required /></Field>
            <SubmitButton>Sign agreement</SubmitButton>
          </ActionForm>
        </Card>
      ))}

      <Card title="Membership" actions={customer ? <CheckoutButton endpoint="/api/stripe/portal" body={{}} variant="secondary">Manage billing</CheckoutButton> : null}>
        {current.length ? (
          <ul className="space-y-2 text-sm">
            {current.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{m.membership_plans?.name}</span>
                  <span className="block text-xs text-muted">
                    {m.credits_remaining != null ? `${m.credits_remaining} classes left · ` : ""}
                    {m.cancel_at_period_end && m.ends_at ? `ends ${formatDateTime(m.ends_at, gym.timezone)}` : m.current_period_end ? `renews ${formatDateTime(m.current_period_end, gym.timezone)}` : m.ends_at ? `valid until ${formatDateTime(m.ends_at, gym.timezone)}` : ""}
                  </span>
                </span>
                <StatusBadge status={m.status} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>You do not have a membership yet.</Empty>
        )}
        {unsigned.length ? (
          <p className="mt-4 text-sm text-warn">Sign the agreement above to buy a membership.</p>
        ) : (
          <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            {(plans ?? []).filter((p) => !(hasRecurring && p.kind === "recurring")).map((p) => (
              <div key={p.id} className="rounded-2xl bg-raised p-3.5">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted">{p.description}</p>
                <div className="mt-2"><CheckoutButton body={{ kind: "plan", id: p.id }} variant="secondary">{money(p.price_cents, p.currency)}{p.billing_interval ? ` / ${p.billing_interval}` : ""}</CheckoutButton></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Online programs">
        {enrollments?.length ? (
          <ul className="space-y-3 text-sm">
            {enrollments.map((e) => {
              const ended = e.status === "active" && e.expires_at != null && e.expires_at < today;
              const notStarted = e.status === "active" && e.start_date > today;
              return (
                <li key={e.id} className="rounded-2xl bg-raised p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{e.programs?.name}</span>
                    <StatusBadge status={ended ? "expired" : e.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {notStarted ? "Starts" : "Started"} {formatDate(e.start_date, { month: "long", day: "numeric" })}
                    {e.expires_at ? ` · access until ${formatDate(e.expires_at, { month: "long", day: "numeric" })}` : ""}
                  </p>
                  {notStarted ? (
                    <ActionForm action={changeStartDate} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <Field label="Change start date"><Input type="date" name="start_date" defaultValue={e.start_date} min={today} className="py-1 text-xs" /></Field>
                      <SubmitButton small variant="secondary">Save</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>You are not enrolled in a program.</Empty>
        )}
        <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          {(programs ?? []).filter((p) => !enrolledIds.has(p.id)).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <span><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.summary}</span></span>
              <Link href={`/programs/${p.slug}`} className="whitespace-nowrap underline">{money(p.price_cents, p.currency)} →</Link>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
