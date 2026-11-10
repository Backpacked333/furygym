import type Stripe from "stripe";
import type { Database } from "@/lib/database.types";

type Plan = Database["public"]["Tables"]["membership_plans"]["Row"];
type Program = Database["public"]["Tables"]["programs"]["Row"];

export type CheckoutTarget = { kind: "plan"; plan: Plan } | { kind: "program"; program: Program; startDate: string };

export type CheckoutContext = {
  userId: string;
  gymId: string;
  customerId: string;
  siteUrl: string;
  /** "app" sends the athlete back into the iOS app after paying. */
  returnTo: "app" | "web";
  automaticTax: boolean;
};

/** Builds the Stripe Checkout session for a plan or a program. Pure, so it can be tested without Stripe. */
export function buildCheckoutSession(target: CheckoutTarget, ctx: CheckoutContext): Stripe.Checkout.SessionCreateParams {
  const item = target.kind === "plan" ? target.plan : target.program;
  const recurring = target.kind === "plan" && target.plan.kind === "recurring";

  // The webhook reads this back to know what was bought and for whom.
  const metadata: Record<string, string> = {
    kind: target.kind,
    user_id: ctx.userId,
    gym_id: ctx.gymId,
    ...(target.kind === "plan" ? { plan_id: target.plan.id, plan_kind: target.plan.kind } : { program_id: target.program.id, start_date: target.startDate }),
  };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = item.stripe_price_id
    ? { price: item.stripe_price_id, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: item.currency,
          unit_amount: item.price_cents,
          product_data: { name: item.name },
          ...(recurring ? { recurring: { interval: (target.plan.billing_interval ?? "month") as "week" | "month" | "year" } } : {}),
        },
      };

  const back = `return=${ctx.returnTo}`;
  return {
    mode: recurring ? "subscription" : "payment",
    customer: ctx.customerId,
    client_reference_id: ctx.userId,
    line_items: [lineItem],
    metadata,
    ...(recurring ? { subscription_data: { metadata } } : { payment_intent_data: { metadata, description: item.name } }),
    allow_promotion_codes: true,
    ...(ctx.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" as const } } : {}),
    success_url: `${ctx.siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&${back}`,
    cancel_url: `${ctx.siteUrl}/checkout/cancelled?${back}`,
  };
}

/** Start dates are the athlete's choice, from today up to 90 days out. */
export function validStartDate(requested: string | undefined | null, today: string, maxDaysAhead = 90): string | null {
  if (!requested) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return null;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + maxDaysAhead);
  if (requested < today || requested > limit.toISOString().slice(0, 10)) return null;
  return requested;
}
