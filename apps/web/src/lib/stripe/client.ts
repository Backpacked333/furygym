import Stripe from "stripe";
import { env } from "@/lib/env";

let cached: Stripe | null | undefined;

/** The Stripe client, or null when no secret key is configured (payments switched off). */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = env.stripeSecretKey;
  cached = key ? new Stripe(key, { appInfo: { name: "Fury Co. Athletics" } }) : null;
  return cached;
}

export const PAYMENTS_OFF = "Payments are not configured yet. Add the Stripe keys to switch them on.";
