import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

// The Stripe webhook is the only writer of memberships-from-payment, enrollments-from-payment,
// payments and payouts. Every handler is safe to run twice: Stripe retries, and events can arrive
// out of order (invoice.paid before checkout.session.completed, for example).

type MembershipStatus = Database["public"]["Enums"]["membership_status"];
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];

export type SubscriptionInfo = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number | null;
  paused: boolean;
  resumes_at: number | null;
  ended_at: number | null;
  metadata: Record<string, string>;
};

export type PaymentDetails = { chargeId: string | null; feeCents: number | null; balanceTransactionId: string | null };

/** The calls the webhook makes back to Stripe. Faked in tests. */
export interface StripeGateway {
  getSubscription(id: string): Promise<SubscriptionInfo>;
  getPaymentDetails(paymentIntentId: string): Promise<PaymentDetails>;
  getInvoicePaymentIntentId(invoiceId: string): Promise<string | null>;
}

// Only the fields we read. Events arrive as JSON, so everything is optional.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
export type StripeEventLike = { id: string; type: string; data: { object: Obj } };
export type WebhookResult = "processed" | "duplicate" | "ignored" | "deferred";

class DeferredStripeEvent extends Error {}

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const idOf = (value: unknown): string | null => (typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : null);

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

/** Like must(), for rows that have to exist. */
function need<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = must(result, what);
  if (data == null) throw new Error(`${what}: not found`);
  return data;
}

export function membershipStatusFor(sub: Pick<SubscriptionInfo, "status" | "paused">): MembershipStatus | null {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return "cancelled";
  if (sub.paused || sub.status === "paused") return "frozen";
  if (sub.status === "active" || sub.status === "trialing") return "active";
  if (sub.status === "past_due" || sub.status === "unpaid") return "past_due";
  return null; // "incomplete": first payment not made yet — no access to grant
}

export async function handleStripeEvent(event: StripeEventLike, db: AppSupabaseClient, gateway: StripeGateway): Promise<WebhookResult> {
  const seen = must(await db.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle(), "read stripe_events");
  if (seen?.processed_at) return "duplicate";
  if (!seen) must(await db.from("stripe_events").upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true }), "record event");

  try {
    const handled = await dispatch(event, db, gateway);
    must(await db.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id), "mark event processed");
    return handled ? "processed" : "ignored";
  } catch (error) {
    await db.from("stripe_events").update({ error: error instanceof Error ? error.message : String(error) }).eq("id", event.id);
    if (error instanceof DeferredStripeEvent) return "deferred";
    throw error; // a non-2xx response makes Stripe retry
  }
}

async function dispatch(event: StripeEventLike, db: AppSupabaseClient, gateway: StripeGateway): Promise<boolean> {
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return checkoutCompleted(object, db, gateway);
    case "invoice.paid":
      return invoicePaid(object, db, gateway);
    case "invoice.payment_failed":
      return invoiceFailed(object, db, gateway);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return (await syncSubscription(String(object.id), db, gateway)) !== null;
    case "charge.refunded":
      return chargeRefunded(object, db);
    case "charge.succeeded":
    case "charge.updated":
      return chargeFeeSettled(object, db, gateway);
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled":
      return payoutChanged(object, db);
    default:
      return false;
  }
}

// --- memberships from subscriptions ----------------------------------------------------------

async function syncSubscription(subscriptionId: string, db: AppSupabaseClient, gateway: StripeGateway, fallbackMeta: Record<string, string> = {}) {
  const sub = await gateway.getSubscription(subscriptionId);
  const meta = { ...fallbackMeta, ...sub.metadata };
  const status = membershipStatusFor(sub);

  const existing = must(await db.from("memberships").select("*").eq("stripe_subscription_id", sub.id).maybeSingle(), "read membership");
  if (!existing && (!status || !meta.user_id || !meta.gym_id || !meta.plan_id)) return null;

  const periodEnd = iso(sub.current_period_end);
  const patch = {
    status: status ?? existing!.status,
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end,
    ends_at: status === "cancelled" ? (iso(sub.ended_at) ?? new Date().toISOString()) : sub.cancel_at_period_end ? periodEnd : null,
    frozen_until: status === "frozen" ? (sub.resumes_at ? iso(sub.resumes_at)!.slice(0, 10) : (existing?.frozen_until ?? null)) : null,
  };

  if (existing) {
    return need(await db.from("memberships").update(patch).eq("id", existing.id).select().single(), "update membership");
  }
  const inserted = await db
    .from("memberships")
    .insert({ ...patch, gym_id: meta.gym_id, user_id: meta.user_id, plan_id: meta.plan_id, source: "stripe", stripe_subscription_id: sub.id })
    .select()
    .single();
  if (inserted.error?.code === "23505") {
    // A concurrent event created it first.
    return need(await db.from("memberships").update(patch).eq("stripe_subscription_id", sub.id).select().single(), "update membership");
  }
  return need(inserted, "create membership");
}

// --- checkout ------------------------------------------------------------------------------

async function checkoutCompleted(session: Obj, db: AppSupabaseClient, gateway: StripeGateway): Promise<boolean> {
  const meta: Record<string, string> = session.metadata ?? {};
  if (!meta.user_id || !meta.gym_id) return false;

  const customerId = idOf(session.customer);
  if (customerId) {
    must(await db.from("stripe_customers").upsert({ user_id: meta.user_id, stripe_customer_id: customerId }, { onConflict: "user_id" }), "save customer");
  }

  if (session.mode === "subscription") {
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return false;
    const membership = await syncSubscription(subscriptionId, db, gateway, meta);
    if (membership && !membership.stripe_checkout_session_id) {
      must(await db.from("memberships").update({ stripe_checkout_session_id: session.id }).eq("id", membership.id), "link session");
    }
    return true; // the payment row comes from invoice.paid
  }

  // One-time payments: wait for the money. Delayed methods fire async_payment_succeeded later.
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return false;

  const paymentIntentId = idOf(session.payment_intent);
  const details = paymentIntentId ? await gateway.getPaymentDetails(paymentIntentId) : null;
  const base = {
    gym_id: meta.gym_id,
    user_id: meta.user_id,
    amount_cents: session.amount_total ?? 0,
    tax_cents: session.total_details?.amount_tax ?? 0,
    currency: session.currency ?? "usd",
    stripe_checkout_session_id: session.id as string,
    stripe_payment_intent_id: paymentIntentId,
    paid_at: iso(session.created) ?? new Date().toISOString(),
  };

  if (meta.kind === "plan" && meta.plan_id) {
    const plan = need(await db.from("membership_plans").select("*").eq("id", meta.plan_id).single(), "read plan");
    const endsAt = plan.duration_days ? new Date(Date.now() + plan.duration_days * 86_400_000).toISOString() : null;
    must(
      await db.from("memberships").upsert(
        { gym_id: meta.gym_id, user_id: meta.user_id, plan_id: plan.id, status: "active", source: "stripe", credits_remaining: plan.class_credits, ends_at: endsAt, stripe_checkout_session_id: session.id },
        { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
      ),
      "create membership",
    );
    const membership = need(await db.from("memberships").select("id").eq("stripe_checkout_session_id", session.id).single(), "read membership");
    const kind = plan.kind === "recurring" ? "membership" : plan.kind;
    await recordPayment(db, { ...base, kind, revenue_stream: "facility", description: plan.name, plan_id: plan.id, membership_id: membership.id }, details);
    return true;
  }

  if (meta.kind === "program" && meta.program_id) {
    const program = need(await db.from("programs").select("id, name").eq("id", meta.program_id).single(), "read program");
    const today = need(await db.rpc("gym_today", { p_gym: meta.gym_id }), "gym_today");
    const start = /^\d{4}-\d{2}-\d{2}$/.test(meta.start_date ?? "") && meta.start_date >= today ? meta.start_date : today;

    let enrollment = must(await db.from("enrollments").select("id, stripe_checkout_session_id").eq("stripe_checkout_session_id", session.id).maybeSingle(), "read enrollment");
    if (!enrollment) {
      const created = await db
        .from("enrollments")
        .insert({ gym_id: meta.gym_id, program_id: program.id, user_id: meta.user_id, start_date: start, source: "stripe", stripe_checkout_session_id: session.id })
        .select("id, stripe_checkout_session_id")
        .single();
      if (created.error?.code === "23505") {
        // Already enrolled (a replay, or a second purchase of a program still in progress): keep the
        // existing enrollment and attach this payment to it so an admin can see and refund it.
        enrollment = must(await db.from("enrollments").select("id, stripe_checkout_session_id").eq("stripe_checkout_session_id", session.id).maybeSingle(), "read replayed enrollment") ?? need(
          await db.from("enrollments").select("id, stripe_checkout_session_id").eq("program_id", program.id).eq("user_id", meta.user_id).eq("status", "active").single(),
          "read active enrollment",
        );
      } else {
        enrollment = need(created, "create enrollment");
      }
    }
    const description = enrollment!.stripe_checkout_session_id === session.id ? program.name : `${program.name} (duplicate purchase — review for refund)`;
    await recordPayment(db, { ...base, kind: "program", revenue_stream: "digital", description, program_id: program.id, enrollment_id: enrollment!.id }, details);
    return true;
  }
  return false;
}

// --- payments --------------------------------------------------------------------------------

type PaymentInput = Omit<PaymentInsert, "status" | "fee_cents"> & { status?: PaymentInsert["status"]; failure_reason?: string | null };

async function findPayment(db: AppSupabaseClient, keys: { invoice?: string | null; intent?: string | null; charge?: string | null }): Promise<PaymentRow | null> {
  for (const [column, value] of [["stripe_invoice_id", keys.invoice], ["stripe_payment_intent_id", keys.intent], ["stripe_charge_id", keys.charge]] as const) {
    if (!value) continue;
    const row = must(await db.from("payments").select("*").eq(column, value).maybeSingle(), "read payment");
    if (row) return row;
  }
  return null;
}

async function recordPayment(db: AppSupabaseClient, input: PaymentInput, details: PaymentDetails | null) {
  const status = input.status ?? "succeeded";
  const stripe = {
    stripe_charge_id: details?.chargeId ?? null,
    stripe_balance_transaction_id: details?.balanceTransactionId ?? null,
  };
  const existing = await findPayment(db, { invoice: input.stripe_invoice_id, intent: input.stripe_payment_intent_id });

  if (existing) {
    // Never undo a refund or a success because an older event was replayed.
    const settled = existing.status === "refunded" || existing.status === "partially_refunded" || (existing.status === "succeeded" && status !== "succeeded");
    const patch: Database["public"]["Tables"]["payments"]["Update"] = {
      membership_id: existing.membership_id ?? input.membership_id ?? null,
      enrollment_id: existing.enrollment_id ?? input.enrollment_id ?? null,
      stripe_payment_intent_id: existing.stripe_payment_intent_id ?? input.stripe_payment_intent_id ?? null,
      stripe_charge_id: existing.stripe_charge_id ?? stripe.stripe_charge_id,
      stripe_balance_transaction_id: existing.stripe_balance_transaction_id ?? stripe.stripe_balance_transaction_id,
      fee_cents: details?.feeCents ?? existing.fee_cents,
    };
    if (!settled) {
      Object.assign(patch, { status, amount_cents: input.amount_cents, tax_cents: input.tax_cents ?? 0, paid_at: input.paid_at ?? existing.paid_at, failure_reason: status === "failed" ? (input.failure_reason ?? null) : null });
    }
    must(await db.from("payments").update(patch).eq("id", existing.id), "update payment");
    return;
  }
  const inserted = await db.from("payments").insert({ ...input, ...stripe, status, fee_cents: details?.feeCents ?? 0 });
  // Lost a race with a concurrent delivery of the same event: the other one wrote it.
  if (inserted.error && inserted.error.code !== "23505") throw new Error(`create payment: ${inserted.error.message}`);
}

function invoiceSubscription(invoice: Obj): { id: string | null; meta: Record<string, string> } {
  const details = invoice.parent?.subscription_details;
  return { id: idOf(details?.subscription) ?? idOf(invoice.subscription), meta: details?.metadata ?? invoice.subscription_details?.metadata ?? {} };
}

const invoiceTax = (invoice: Obj): number =>
  Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((n: number, t: Obj) => n + (t.amount ?? 0), 0) : (invoice.tax ?? 0);

async function invoicePaid(invoice: Obj, db: AppSupabaseClient, gateway: StripeGateway): Promise<boolean> {
  const { id: subscriptionId, meta } = invoiceSubscription(invoice);
  if (!subscriptionId) return false;
  const membership = await syncSubscription(subscriptionId, db, gateway, meta);
  if (!membership) return false;
  if (!invoice.amount_paid) return true; // 100% coupon or trial: access granted, nothing to record as revenue

  const plan = need(await db.from("membership_plans").select("name").eq("id", membership.plan_id).single(), "read plan");
  const paymentIntentId = await gateway.getInvoicePaymentIntentId(invoice.id);
  const details = paymentIntentId ? await gateway.getPaymentDetails(paymentIntentId) : null;
  await recordPayment(
    db,
    {
      gym_id: membership.gym_id,
      user_id: membership.user_id,
      kind: "membership",
      revenue_stream: "facility",
      description: plan.name,
      plan_id: membership.plan_id,
      membership_id: membership.id,
      amount_cents: invoice.amount_paid,
      tax_cents: invoiceTax(invoice),
      currency: invoice.currency ?? "usd",
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: iso(invoice.status_transitions?.paid_at) ?? new Date().toISOString(),
    },
    details,
  );
  return true;
}

async function invoiceFailed(invoice: Obj, db: AppSupabaseClient, gateway: StripeGateway): Promise<boolean> {
  const { id: subscriptionId, meta } = invoiceSubscription(invoice);
  if (!subscriptionId) return false;
  const membership = await syncSubscription(subscriptionId, db, gateway, meta);
  if (!membership) return false;
  const plan = need(await db.from("membership_plans").select("name").eq("id", membership.plan_id).single(), "read plan");
  await recordPayment(
    db,
    {
      gym_id: membership.gym_id,
      user_id: membership.user_id,
      kind: "membership",
      revenue_stream: "facility",
      description: plan.name,
      plan_id: membership.plan_id,
      membership_id: membership.id,
      amount_cents: invoice.amount_due ?? 0,
      tax_cents: invoiceTax(invoice),
      currency: invoice.currency ?? "usd",
      stripe_invoice_id: invoice.id,
      status: "failed",
      failure_reason: invoice.last_finalization_error?.message ?? "Card payment failed",
    },
    null,
  );
  return true;
}

async function chargeRefunded(charge: Obj, db: AppSupabaseClient): Promise<boolean> {
  const payment = await findPayment(db, { intent: idOf(charge.payment_intent), charge: charge.id });
  if (!payment) throw new DeferredStripeEvent("Refund awaits its payment row; retry after checkout or invoice reconciliation.");
  must(
    await db.rpc("apply_payment_refund", { p_payment: payment.id, p_refunded: charge.amount_refunded ?? 0, p_charge: charge.id }),
    "apply refund",
  );
  return true;
}

/** Stripe often settles the processing fee a moment after the charge succeeds. */
async function chargeFeeSettled(charge: Obj, db: AppSupabaseClient, gateway: StripeGateway): Promise<boolean> {
  const paymentIntentId = idOf(charge.payment_intent);
  if (!paymentIntentId || !charge.balance_transaction) return false;
  const payment = await findPayment(db, { intent: paymentIntentId, charge: charge.id });
  if (!payment || payment.fee_cents > 0) return false;
  const details = await gateway.getPaymentDetails(paymentIntentId);
  if (details.feeCents == null) return false;
  must(
    await db.from("payments").update({ fee_cents: details.feeCents, stripe_charge_id: payment.stripe_charge_id ?? details.chargeId, stripe_balance_transaction_id: details.balanceTransactionId }).eq("id", payment.id),
    "update fee",
  );
  return true;
}

async function payoutChanged(payout: Obj, db: AppSupabaseClient): Promise<boolean> {
  const gym = need(await db.from("gyms").select("id").eq("is_default", true).single(), "read gym");
  must(
    await db.from("payouts").upsert(
      { gym_id: gym.id, stripe_payout_id: payout.id, amount_cents: payout.amount ?? 0, currency: payout.currency ?? "usd", status: payout.status ?? "pending", arrival_date: iso(payout.arrival_date)?.slice(0, 10) ?? null },
      { onConflict: "stripe_payout_id" },
    ),
    "save payout",
  );
  return true;
}
