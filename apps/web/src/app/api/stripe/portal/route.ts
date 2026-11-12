import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe/client";

// Opens Stripe's hosted billing portal: update card, see invoices, cancel a subscription.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });

  const { data: customer } = await auth.supabase.from("stripe_customers").select("stripe_customer_id").eq("user_id", auth.user.id).maybeSingle();
  if (!customer) return NextResponse.json({ error: "no_billing_account", message: "You have no payments on file yet." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { return_to?: string };
  const returnUrl = body.return_to === "app" ? `${env.siteUrl}/checkout/success?return=app&portal=1` : `${env.siteUrl}/account`;
  try {
    const session = await stripe.billingPortal.sessions.create({ customer: customer.stripe_customer_id, return_url: returnUrl });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("portal failed", error);
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }
}
