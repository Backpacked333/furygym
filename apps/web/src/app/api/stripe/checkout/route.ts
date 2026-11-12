import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { buildCheckoutSession, validStartDate, type CheckoutTarget } from "@/lib/stripe/checkout";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  kind: z.enum(["plan", "program"]),
  id: z.string().uuid(),
  start_date: z.string().optional(),
  return_to: z.enum(["app", "web"]).default("web"),
});

const refuse = (error: string, status: number, message?: string) => NextResponse.json({ error, message }, { status });

// Creates a Stripe Checkout session for a membership plan or an online program and returns its URL.
// Called by the website and by the iOS app (Bearer token).
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return refuse("not_authenticated", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid_request", 400);
  const { kind, id, return_to } = parsed.data;
  const { user, supabase } = auth;

  const { data: gym } = await supabase.from("gyms").select("id").eq("is_default", true).single();
  if (!gym) return refuse("gym_unavailable", 503);
  const { data: member } = await supabase.from("gym_members").select("status").eq("gym_id", gym.id).eq("user_id", user.id).maybeSingle();
  if (member?.status !== "active") return refuse("not_a_member", 403, "Your gym access is inactive. Contact the gym before making a purchase.");
  const admin = createAdminClient();

  let target: CheckoutTarget;
  if (kind === "plan") {
    const { data: plan } = await supabase.from("membership_plans").select("*").eq("id", id).eq("active", true).maybeSingle();
    if (!plan) return refuse("not_found", 404, "That plan is no longer on sale.");

    const { data: waivers } = await supabase.from("waivers").select("id").eq("required", true).eq("active", true);
    const { data: signed } = await supabase.from("waiver_signatures").select("waiver_id").eq("user_id", user.id);
    const signedIds = new Set((signed ?? []).map((s) => s.waiver_id));
    if ((waivers ?? []).some((w) => !signedIds.has(w.id))) return refuse("waiver_required", 409, "Sign the waiver before buying a membership.");

    if (plan.kind === "recurring") {
      const { data: current } = await supabase.from("memberships").select("id, membership_plans(kind)").eq("user_id", user.id).in("status", ["active", "past_due", "frozen"]);
      if ((current ?? []).some((m) => m.membership_plans?.kind === "recurring")) {
        return refuse("already_subscribed", 409, "You already have a membership. Manage it from your account.");
      }
    }
    if (plan.price_cents === 0) return refuse("not_purchasable", 409, "Ask the front desk to add this plan.");
    target = { kind: "plan", plan };
  } else {
    const { data: program } = await supabase.from("programs").select("*").eq("id", id).eq("status", "published").maybeSingle();
    if (!program) return refuse("not_found", 404, "That program is not available.");

    const { data: today } = await admin.rpc("gym_today", { p_gym: gym.id });
    const startDate = validStartDate(parsed.data.start_date, today ?? new Date().toISOString().slice(0, 10));
    if (!startDate) return refuse("invalid_start_date", 400, "Choose a start date within the next 90 days.");

    const { data: enrolled } = await supabase.from("enrollments").select("id").eq("program_id", id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (enrolled) return refuse("already_enrolled", 409, "You are already enrolled in this program.");

    if (program.price_cents === 0) {
      // Free programs skip Stripe entirely.
      const { error } = await admin.from("enrollments").insert({ gym_id: gym.id, program_id: program.id, user_id: user.id, start_date: startDate, source: "comp" });
      if (error) return refuse("enroll_failed", 500);
      return NextResponse.json({ url: `${env.siteUrl}/checkout/success?return=${return_to}`, free: true });
    }
    target = { kind: "program", program, startDate };
  }

  const stripe = getStripe();
  if (!stripe) return refuse("payments_not_configured", 503, "Online payment is not switched on yet. Please pay at the front desk.");

  try {
    const { data: known } = await admin.from("stripe_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    let customerId = known?.stripe_customer_id;
    if (!customerId) {
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const customer = await stripe.customers.create({ email: user.email, name: profile?.full_name || undefined, metadata: { user_id: user.id } });
      customerId = customer.id;
      await admin.from("stripe_customers").upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: "user_id" });
    }

    const session = await stripe.checkout.sessions.create(
      buildCheckoutSession(target, { userId: user.id, gymId: gym.id, customerId, siteUrl: env.siteUrl, returnTo: return_to, automaticTax: env.stripeAutomaticTax }),
    );
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("checkout failed", error);
    return refuse("checkout_failed", 502, "Could not start checkout. Please try again.");
  }
}
