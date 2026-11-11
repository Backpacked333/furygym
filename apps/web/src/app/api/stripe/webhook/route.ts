import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe/client";
import { stripeGateway } from "@/lib/stripe/gateway";
import { handleStripeEvent } from "@/lib/stripe/webhook";
import { createAdminClient } from "@/lib/supabase/server";

// Stripe → us. The signature check is the only authentication, so it must use the raw body.
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = env.stripeWebhookSecret;
  if (!stripe || !secret) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, createAdminClient(), stripeGateway(stripe));
    return NextResponse.json({ received: result !== "deferred", result }, { status: result === "deferred" ? 503 : 200 });
  } catch (error) {
    console.error(`stripe webhook ${event.type} ${event.id} failed`, error);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
