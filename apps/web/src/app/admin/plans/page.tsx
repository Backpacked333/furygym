import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, money, titleCase } from "@/lib/format";
import { getStripe } from "@/lib/stripe/client";
import { publishWaiver, saveGymSettings, savePlan } from "./actions";

export const metadata = { title: "Plans & settings" };

type Plan = { id: string; name: string; description: string | null; kind: string; price_cents: number; billing_interval: string | null; class_credits: number | null; duration_days: number | null; stripe_price_id: string | null; active: boolean; is_public: boolean; position: number };

function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <Field label="Name"><Input name="name" defaultValue={plan?.name} placeholder="Unlimited Monthly" required /></Field>
      <Field label="Type">
        <Select name="kind" defaultValue={plan?.kind ?? "recurring"}>
          <option value="recurring">Recurring membership</option>
          <option value="class_pack">Class pack</option>
          <option value="drop_in">Drop-in (one class)</option>
          <option value="intro">Intro offer (unlimited, fixed length)</option>
        </Select>
      </Field>
      <Field label="Price (USD)"><Input name="price" inputMode="decimal" defaultValue={plan ? (plan.price_cents / 100).toFixed(2) : ""} required /></Field>
      <Field label="Billed every" hint="Recurring memberships only.">
        <Select name="billing_interval" defaultValue={plan?.billing_interval ?? "month"}>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </Select>
      </Field>
      <Field label="Classes included" hint="Class packs only."><Input name="class_credits" type="number" min={1} defaultValue={plan?.class_credits ?? ""} /></Field>
      <Field label="Valid for (days)" hint="Packs, drop-ins and intro offers."><Input name="duration_days" type="number" min={1} defaultValue={plan?.duration_days ?? ""} /></Field>
      <Field label="Description" className="sm:col-span-2"><Input name="description" defaultValue={plan?.description ?? ""} /></Field>
      <Field label="Stripe price ID" hint="Optional. Leave empty to charge the price above directly."><Input name="stripe_price_id" defaultValue={plan?.stripe_price_id ?? ""} placeholder="price_…" /></Field>
      <Field label="Sort order"><Input name="position" type="number" defaultValue={plan?.position ?? 0} /></Field>
      {plan ? (
        <div className="flex gap-4 text-sm sm:col-span-2">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={plan.active} /> On sale</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="is_public" defaultChecked={plan.is_public} /> Listed in the app and on the website</label>
        </div>
      ) : null}
    </div>
  );
}

export default async function PlansPage() {
  const { supabase, gym } = await requireAdmin();
  const [{ data: plans }, { data: waivers }, { count: signed }] = await Promise.all([
    supabase.from("membership_plans").select("*").order("position").order("name"),
    supabase.from("waivers").select("*").order("version", { ascending: false }),
    supabase.from("waiver_signatures").select("id", { count: "exact", head: true }),
  ]);
  const current = waivers?.find((w) => w.active);
  const paymentsOn = Boolean(getStripe());

  return (
    <>
      <PageHeader eyebrow="Business" title="Plans & settings" description="Membership plans, the waiver athletes sign, and gym-wide rules." />
      {!paymentsOn ? (
        <p className="mb-4 rounded-2xl bg-warn/15 px-3 py-2 text-sm text-warn">
          Stripe is not connected, so athletes cannot pay yet. You can still add memberships by hand from a member&apos;s page.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Membership plans">
          {plans?.length ? (
            <ul className="divide-y divide-line">
              {plans.map((p) => (
                <li key={p.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{money(p.price_cents, p.currency)}{p.billing_interval ? ` / ${p.billing_interval}` : ""}</span>
                        <Badge>{titleCase(p.kind)}</Badge>
                        {!p.active ? <Badge tone="warn">Off sale</Badge> : null}
                      </span>
                    </summary>
                    <ActionForm action={savePlan} resetOnSuccess={false} className="mt-3 rounded-2xl bg-raised p-3.5">
                      <PlanFields plan={p} />
                      <div className="mt-3"><SubmitButton small>Save plan</SubmitButton></div>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No plans yet.</Empty>
          )}
        </Card>

        <Card title="New plan">
          <ActionForm action={savePlan}>
            <PlanFields />
            <div className="mt-4"><SubmitButton>Create plan</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="Waiver & membership agreement">
          {current ? (
            <p className="mb-3 text-sm text-muted">
              Current: <span className="text-ink">{current.title}</span> (version {current.version}, published {formatDateTime(current.created_at, gym.timezone)}). {signed ?? 0} signatures on record across all versions.
            </p>
          ) : (
            <p className="mb-3 text-sm text-warn">No waiver is published. Athletes can book without signing anything.</p>
          )}
          <ActionForm action={publishWaiver} className="space-y-3">
            <Field label="Title"><Input name="title" defaultValue={current?.title ?? "Liability Waiver & Membership Agreement"} required /></Field>
            <Field label="Agreement text" hint="Athletes type their full name to sign. Each signature is stored with the time, IP address and device.">
              <Textarea name="body" defaultValue={current?.body ?? ""} className="min-h-48" required />
            </Field>
            <SubmitButton variant="secondary" confirm="Publish this as a new version? Everyone will need to sign again before booking.">Publish new version</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Gym settings">
          <ActionForm action={saveGymSettings} resetOnSuccess={false}>
            <Field label="Gym name"><Input name="name" defaultValue={gym.name} required /></Field>
            <Field label="Timezone" hint="Class times, workout dates and publish times all use this."><Input name="timezone" defaultValue={gym.timezone} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Booking opens (days ahead)"><Input name="booking_window_days" type="number" min={1} max={365} defaultValue={gym.booking_window_days} /></Field>
              <Field label="Free cancellation until (minutes before)"><Input name="cancel_cutoff_minutes" type="number" min={0} defaultValue={gym.cancel_cutoff_minutes} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Attendance milestone (visits)" hint="The app counts check-ins toward this."><Input name="milestone_visits" type="number" min={1} max={1000} defaultValue={gym.milestone_visits} /></Field>
              <Field label="Milestone reward" hint="Shown as “20 visits earns …”. Leave empty for no reward."><Input name="milestone_reward" defaultValue={gym.milestone_reward ?? ""} placeholder="a free Fury Co. tee" /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="ios_program_purchase_link" defaultChecked={gym.ios_program_purchase_link} className="mt-1" />
              <span>Show the “buy on the web” link for online programs in the iOS app<span className="block text-xs text-muted">US App Store only. Switch off if App Review objects; athletes can still buy on the website.</span></span>
            </label>
            <SubmitButton variant="secondary">Save settings</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
