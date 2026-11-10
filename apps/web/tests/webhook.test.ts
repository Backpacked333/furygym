import { beforeAll, describe, expect, it } from "vitest";
import { handleStripeEvent, membershipStatusFor, type PaymentDetails, type StripeEventLike, type StripeGateway, type SubscriptionInfo } from "@/lib/stripe/webhook";
import { adminClient, newAthlete } from "./local";

// Runs the real webhook handler against the local database with a fake Stripe behind it.

const db = adminClient();
let gym: string;
let today: string;
let plans: Record<string, { id: string; name: string }>;
let program: { id: string; duration_weeks: number; grace_days: number };

let seq = 0;
const uid = (prefix: string) => `${prefix}_test_${Date.now()}_${seq++}`;
const now = () => Math.floor(Date.now() / 1000);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

class FakeStripe implements StripeGateway {
  subscriptions = new Map<string, SubscriptionInfo>();
  payments = new Map<string, PaymentDetails>();
  invoiceIntents = new Map<string, string>();
  async getSubscription(id: string) {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`No such subscription: ${id}`);
    return sub;
  }
  async getPaymentDetails(id: string) {
    return this.payments.get(id) ?? { chargeId: null, feeCents: null, balanceTransactionId: null };
  }
  async getInvoicePaymentIntentId(id: string) {
    return this.invoiceIntents.get(id) ?? null;
  }
}

const event = (type: string, object: Record<string, unknown>, id = uid("evt")): StripeEventLike => ({ id, type, data: { object } });

function subscription(overrides: Partial<SubscriptionInfo> & { id: string }): SubscriptionInfo {
  return { status: "active", cancel_at_period_end: false, current_period_end: now() + 30 * 86400, paused: false, resumes_at: null, ended_at: null, metadata: {}, ...overrides };
}

beforeAll(async () => {
  const { data: g } = await db.from("gyms").select("id").eq("is_default", true).single();
  gym = g!.id;
  today = (await db.rpc("gym_today", { p_gym: gym })).data!;
  const { data: planRows } = await db.from("membership_plans").select("id, name, kind");
  plans = Object.fromEntries(planRows!.map((p) => [p.kind, { id: p.id, name: p.name }]));
  program = (await db.from("programs").select("id, duration_weeks, grace_days").eq("slug", "selection-prep-6").single()).data!;
});

describe("membershipStatusFor", () => {
  it("maps Stripe subscription states onto membership states", () => {
    expect(membershipStatusFor({ status: "active", paused: false })).toBe("active");
    expect(membershipStatusFor({ status: "trialing", paused: false })).toBe("active");
    expect(membershipStatusFor({ status: "active", paused: true })).toBe("frozen");
    expect(membershipStatusFor({ status: "past_due", paused: false })).toBe("past_due");
    expect(membershipStatusFor({ status: "unpaid", paused: false })).toBe("past_due");
    expect(membershipStatusFor({ status: "canceled", paused: true })).toBe("cancelled");
    expect(membershipStatusFor({ status: "incomplete", paused: false })).toBeNull();
  });
});

describe("one-time purchases", () => {
  it("turns a paid class-pack checkout into a membership with credits and a payment with its fee", async () => {
    const athlete = await newAthlete("pack");
    const stripe = new FakeStripe();
    const sessionId = uid("cs");
    const intent = uid("pi");
    stripe.payments.set(intent, { chargeId: uid("ch"), feeCents: 610, balanceTransactionId: uid("txn") });
    const session = {
      id: sessionId, mode: "payment", payment_status: "paid", customer: uid("cus"), payment_intent: intent,
      amount_total: 21650, total_details: { amount_tax: 1650 }, currency: "usd", created: now(),
      metadata: { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.class_pack.id, plan_kind: "class_pack" },
    };

    const first = event("checkout.session.completed", session);
    expect(await handleStripeEvent(first, db, stripe)).toBe("processed");
    expect(await handleStripeEvent(first, db, stripe)).toBe("duplicate");
    // Stripe can also deliver the same session under a new event id
    expect(await handleStripeEvent(event("checkout.session.completed", session), db, stripe)).toBe("processed");

    const { data: memberships } = await db.from("memberships").select("*").eq("user_id", athlete.id);
    expect(memberships).toHaveLength(1);
    expect(memberships![0]).toMatchObject({ status: "active", source: "stripe", credits_remaining: 10, plan_id: plans.class_pack.id });
    const validDays = (new Date(memberships![0].ends_at!).getTime() - Date.now()) / 86_400_000;
    expect(validDays).toBeGreaterThan(89);
    expect(validDays).toBeLessThan(91);

    const { data: payments } = await db.from("payments").select("*").eq("user_id", athlete.id);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({
      kind: "class_pack", revenue_stream: "facility", status: "succeeded", amount_cents: 21650, tax_cents: 1650, fee_cents: 610,
      membership_id: memberships![0].id, stripe_payment_intent_id: intent, description: "10 Class Pack",
    });

    const { data: customer } = await db.from("stripe_customers").select("stripe_customer_id").eq("user_id", athlete.id).single();
    expect(customer!.stripe_customer_id).toBe(session.customer);

    // the athlete can now see facility workouts
    expect((await athlete.client.from("workouts").select("id").eq("scheduled_date", today)).data!.length).toBeGreaterThan(0);
  });

  it("waits for the money on delayed payment methods", async () => {
    const athlete = await newAthlete("delayed");
    const stripe = new FakeStripe();
    const session = {
      id: uid("cs"), mode: "payment", payment_status: "unpaid", customer: uid("cus"), payment_intent: uid("pi"), amount_total: 2500, currency: "usd", created: now(),
      metadata: { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.drop_in.id },
    };
    expect(await handleStripeEvent(event("checkout.session.completed", session), db, stripe)).toBe("ignored");
    expect((await db.from("memberships").select("id").eq("user_id", athlete.id)).data).toHaveLength(0);

    expect(await handleStripeEvent(event("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" }), db, stripe)).toBe("processed");
    const { data } = await db.from("memberships").select("credits_remaining").eq("user_id", athlete.id);
    expect(data).toEqual([{ credits_remaining: 1 }]);
  });

  it("enrols a program buyer from their chosen start date, and a full refund takes access back", async () => {
    const athlete = await newAthlete("program");
    const stripe = new FakeStripe();
    const intent = uid("pi");
    const charge = uid("ch");
    stripe.payments.set(intent, { chargeId: charge, feeCents: 462, balanceTransactionId: uid("txn") });
    const start = addDays(today, 5);
    const session = {
      id: uid("cs"), mode: "payment", payment_status: "paid", customer: uid("cus"), payment_intent: intent, amount_total: 14900, currency: "usd", created: now(),
      metadata: { kind: "program", user_id: athlete.id, gym_id: gym, program_id: program.id, start_date: start },
    };
    expect(await handleStripeEvent(event("checkout.session.completed", session), db, stripe)).toBe("processed");
    await handleStripeEvent(event("checkout.session.completed", session), db, stripe);

    const { data: enrollments } = await db.from("enrollments").select("*").eq("user_id", athlete.id);
    expect(enrollments).toHaveLength(1);
    expect(enrollments![0]).toMatchObject({ status: "active", source: "stripe", start_date: start, expires_at: addDays(start, program.duration_weeks * 7 - 1 + program.grace_days) });

    const { data: payments } = await db.from("payments").select("*").eq("user_id", athlete.id);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({ kind: "program", revenue_stream: "digital", amount_cents: 14900, fee_cents: 462, enrollment_id: enrollments![0].id, stripe_charge_id: charge });

    // personalised calendar: day 1 lands on the chosen start date
    const calendar = await athlete.client.rpc("my_calendar", { p_from: today, p_to: addDays(today, 120) });
    expect(calendar.data).toHaveLength(30);
    expect(calendar.data![0].calendar_date).toBe(start);

    // partial refund keeps access; full refund removes it
    await handleStripeEvent(event("charge.refunded", { id: charge, payment_intent: intent, amount: 14900, amount_refunded: 5000 }), db, stripe);
    expect((await db.from("payments").select("status, refunded_cents").eq("user_id", athlete.id).single()).data).toEqual({ status: "partially_refunded", refunded_cents: 5000 });
    expect((await db.from("enrollments").select("status").eq("user_id", athlete.id).single()).data!.status).toBe("active");

    await handleStripeEvent(event("charge.refunded", { id: charge, payment_intent: intent, amount: 14900, amount_refunded: 14900 }), db, stripe);
    expect((await db.from("payments").select("status, refunded_cents").eq("user_id", athlete.id).single()).data).toEqual({ status: "refunded", refunded_cents: 14900 });
    expect((await db.from("enrollments").select("status").eq("user_id", athlete.id).single()).data!.status).toBe("refunded");
    expect((await athlete.client.rpc("my_calendar", { p_from: today, p_to: addDays(today, 120) })).data).toHaveLength(0);

    // a replayed checkout event must not resurrect the refunded payment
    await handleStripeEvent(event("checkout.session.completed", session), db, stripe);
    expect((await db.from("payments").select("status").eq("user_id", athlete.id).single()).data!.status).toBe("refunded");
  });

  it("falls back to today when the start date in the metadata is missing or in the past", async () => {
    const athlete = await newAthlete("nostart");
    const session = {
      id: uid("cs"), mode: "payment", payment_status: "paid", customer: uid("cus"), payment_intent: uid("pi"), amount_total: 14900, currency: "usd", created: now(),
      metadata: { kind: "program", user_id: athlete.id, gym_id: gym, program_id: program.id, start_date: "2020-01-01" },
    };
    await handleStripeEvent(event("checkout.session.completed", session), db, new FakeStripe());
    expect((await db.from("enrollments").select("start_date").eq("user_id", athlete.id).single()).data!.start_date).toBe(today);
  });

  it("backfills the processing fee when Stripe settles it after the checkout event", async () => {
    const athlete = await newAthlete("latefee");
    const stripe = new FakeStripe();
    const intent = uid("pi");
    const charge = uid("ch");
    const session = {
      id: uid("cs"), mode: "payment", payment_status: "paid", customer: uid("cus"), payment_intent: intent, amount_total: 2500, currency: "usd", created: now(),
      metadata: { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.drop_in.id },
    };
    await handleStripeEvent(event("checkout.session.completed", session), db, stripe);
    expect((await db.from("payments").select("fee_cents").eq("user_id", athlete.id).single()).data!.fee_cents).toBe(0);

    stripe.payments.set(intent, { chargeId: charge, feeCents: 103, balanceTransactionId: uid("txn") });
    expect(await handleStripeEvent(event("charge.updated", { id: charge, payment_intent: intent, balance_transaction: "txn_x" }), db, stripe)).toBe("processed");
    expect((await db.from("payments").select("fee_cents, stripe_charge_id").eq("user_id", athlete.id).single()).data).toEqual({ fee_cents: 103, stripe_charge_id: charge });
  });
});

describe("subscriptions", () => {
  it("handles events in any order through the whole membership lifecycle", async () => {
    const athlete = await newAthlete("sub");
    const stripe = new FakeStripe();
    const subId = uid("sub");
    const meta = { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.recurring.id, plan_kind: "recurring" };
    stripe.subscriptions.set(subId, subscription({ id: subId, metadata: meta }));

    // 1. invoice.paid arrives BEFORE checkout.session.completed
    const invoice1 = uid("in");
    const intent1 = uid("pi");
    stripe.invoiceIntents.set(invoice1, intent1);
    stripe.payments.set(intent1, { chargeId: uid("ch"), feeCents: 567, balanceTransactionId: uid("txn") });
    const paid1 = {
      id: invoice1, amount_paid: 18500, amount_due: 18500, currency: "usd", total_taxes: [], status_transitions: { paid_at: now() },
      parent: { subscription_details: { subscription: subId, metadata: meta } },
    };
    expect(await handleStripeEvent(event("invoice.paid", paid1), db, stripe)).toBe("processed");

    const sessionId = uid("cs");
    await handleStripeEvent(event("checkout.session.completed", { id: sessionId, mode: "subscription", payment_status: "paid", customer: uid("cus"), subscription: subId, metadata: meta }), db, stripe);

    let { data: memberships } = await db.from("memberships").select("*").eq("user_id", athlete.id);
    expect(memberships).toHaveLength(1);
    expect(memberships![0]).toMatchObject({ status: "active", source: "stripe", stripe_subscription_id: subId, stripe_checkout_session_id: sessionId, credits_remaining: null, ends_at: null });
    expect(memberships![0].current_period_end).not.toBeNull();
    const membershipId = memberships![0].id;

    let { data: payments } = await db.from("payments").select("*").eq("user_id", athlete.id);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({ kind: "membership", status: "succeeded", amount_cents: 18500, fee_cents: 567, stripe_invoice_id: invoice1, membership_id: membershipId, description: "Unlimited Monthly" });

    // 2. next month's card fails → past due, and the failure is on record
    const invoice2 = uid("in");
    stripe.subscriptions.set(subId, subscription({ id: subId, status: "past_due", metadata: meta }));
    const failed = { id: invoice2, amount_due: 18500, amount_paid: 0, currency: "usd", parent: { subscription_details: { subscription: subId, metadata: meta } } };
    await handleStripeEvent(event("invoice.payment_failed", failed), db, stripe);
    expect((await db.from("memberships").select("status").eq("id", membershipId).single()).data!.status).toBe("past_due");
    const failedRow = (await db.from("payments").select("*").eq("stripe_invoice_id", invoice2).single()).data!;
    expect(failedRow).toMatchObject({ status: "failed", amount_cents: 18500, failure_reason: "Card payment failed" });
    // past-due members keep access while Stripe retries
    expect((await athlete.client.rpc("has_facility_access", { p_gym: gym })).data).toBe(true);

    // 3. the retry succeeds: same invoice becomes a successful payment, not a second row
    const intent2 = uid("pi");
    stripe.invoiceIntents.set(invoice2, intent2);
    stripe.payments.set(intent2, { chargeId: uid("ch"), feeCents: 567, balanceTransactionId: uid("txn") });
    stripe.subscriptions.set(subId, subscription({ id: subId, metadata: meta }));
    await handleStripeEvent(event("invoice.paid", { ...failed, amount_paid: 18500, status_transitions: { paid_at: now() }, total_taxes: [{ amount: 0 }] }), db, stripe);
    payments = (await db.from("payments").select("*").eq("user_id", athlete.id)).data;
    expect(payments).toHaveLength(2);
    expect(payments!.find((p) => p.stripe_invoice_id === invoice2)).toMatchObject({ status: "succeeded", failure_reason: null, fee_cents: 567 });
    expect((await db.from("memberships").select("status").eq("id", membershipId).single()).data!.status).toBe("active");

    // a late replay of the failure must not flip it back
    await handleStripeEvent(event("invoice.payment_failed", failed), db, stripe);
    expect((await db.from("payments").select("status").eq("stripe_invoice_id", invoice2).single()).data!.status).toBe("succeeded");

    // 4. freeze (collection paused) and resume
    stripe.subscriptions.set(subId, subscription({ id: subId, paused: true, resumes_at: now() + 14 * 86400, metadata: meta }));
    await handleStripeEvent(event("customer.subscription.updated", { id: subId }), db, stripe);
    const frozen = (await db.from("memberships").select("status, frozen_until").eq("id", membershipId).single()).data!;
    expect(frozen.status).toBe("frozen");
    expect(frozen.frozen_until).not.toBeNull();
    expect((await athlete.client.rpc("has_facility_access", { p_gym: gym })).data).toBe(false);

    stripe.subscriptions.set(subId, subscription({ id: subId, metadata: meta }));
    await handleStripeEvent(event("customer.subscription.updated", { id: subId }), db, stripe);
    expect((await db.from("memberships").select("status, frozen_until").eq("id", membershipId).single()).data).toEqual({ status: "active", frozen_until: null });

    // 5. cancel at period end keeps access until the period closes, then the subscription ends
    const periodEnd = now() + 10 * 86400;
    stripe.subscriptions.set(subId, subscription({ id: subId, cancel_at_period_end: true, current_period_end: periodEnd, metadata: meta }));
    await handleStripeEvent(event("customer.subscription.updated", { id: subId }), db, stripe);
    const cancelling = (await db.from("memberships").select("status, cancel_at_period_end, ends_at").eq("id", membershipId).single()).data!;
    expect(cancelling).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(new Date(cancelling.ends_at!).getTime()).toBe(periodEnd * 1000);

    stripe.subscriptions.set(subId, subscription({ id: subId, status: "canceled", ended_at: now() - 5, metadata: meta }));
    await handleStripeEvent(event("customer.subscription.deleted", { id: subId }), db, stripe);
    expect((await db.from("memberships").select("status").eq("id", membershipId).single()).data!.status).toBe("cancelled");
    expect((await athlete.client.rpc("has_facility_access", { p_gym: gym })).data).toBe(false);
    expect((await db.from("memberships").select("id").eq("user_id", athlete.id)).data).toHaveLength(1);
  });

  it("does not grant access for a subscription whose first payment never completed", async () => {
    const athlete = await newAthlete("incomplete");
    const stripe = new FakeStripe();
    const subId = uid("sub");
    const meta = { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.recurring.id };
    stripe.subscriptions.set(subId, subscription({ id: subId, status: "incomplete", metadata: meta }));
    expect(await handleStripeEvent(event("customer.subscription.created", { id: subId }), db, stripe)).toBe("ignored");
    expect((await db.from("memberships").select("id").eq("user_id", athlete.id)).data).toHaveLength(0);
  });

  it("records free first invoices as access without revenue", async () => {
    const athlete = await newAthlete("coupon");
    const stripe = new FakeStripe();
    const subId = uid("sub");
    const meta = { kind: "plan", user_id: athlete.id, gym_id: gym, plan_id: plans.recurring.id };
    stripe.subscriptions.set(subId, subscription({ id: subId, metadata: meta }));
    await handleStripeEvent(event("invoice.paid", { id: uid("in"), amount_paid: 0, currency: "usd", parent: { subscription_details: { subscription: subId, metadata: meta } } }), db, stripe);
    expect((await db.from("memberships").select("status").eq("user_id", athlete.id).single()).data!.status).toBe("active");
    expect((await db.from("payments").select("id").eq("user_id", athlete.id)).data).toHaveLength(0);
  });
});

describe("other events", () => {
  it("tracks payouts and ignores events it does not use", async () => {
    const stripe = new FakeStripe();
    const payoutId = uid("po");
    const arrival = Math.floor(new Date("2031-05-06T00:00:00Z").getTime() / 1000);
    await handleStripeEvent(event("payout.created", { id: payoutId, amount: 123456, currency: "usd", status: "pending", arrival_date: arrival }), db, stripe);
    await handleStripeEvent(event("payout.paid", { id: payoutId, amount: 123456, currency: "usd", status: "paid", arrival_date: arrival }), db, stripe);
    const { data } = await db.from("payouts").select("amount_cents, status, arrival_date").eq("stripe_payout_id", payoutId);
    expect(data).toEqual([{ amount_cents: 123456, status: "paid", arrival_date: "2031-05-06" }]);
    await db.from("payouts").delete().eq("stripe_payout_id", payoutId);

    expect(await handleStripeEvent(event("customer.created", { id: "cus_x" }), db, stripe)).toBe("ignored");
    expect(await handleStripeEvent(event("checkout.session.completed", { id: uid("cs"), mode: "payment", payment_status: "paid", metadata: {} }), db, stripe)).toBe("ignored");
  });

  it("records the error and lets Stripe retry when a handler fails", async () => {
    const stripe = new FakeStripe(); // knows no subscriptions, so the lookup throws
    const failing = event("customer.subscription.updated", { id: "sub_missing" });
    await expect(handleStripeEvent(failing, db, stripe)).rejects.toThrow("No such subscription");
    const row = (await db.from("stripe_events").select("processed_at, error").eq("id", failing.id).single()).data!;
    expect(row.processed_at).toBeNull();
    expect(row.error).toContain("No such subscription");

    // once the cause is fixed the same event id goes through
    const athlete = await newAthlete("retry");
    stripe.subscriptions.set("sub_missing", subscription({ id: uid("sub"), metadata: { user_id: athlete.id, gym_id: gym, plan_id: plans.recurring.id } }));
    expect(await handleStripeEvent(failing, db, stripe)).toBe("processed");
  });
});
