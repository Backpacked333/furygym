import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

// Permanently deletes the caller's account (App Store guideline 5.1.1(v)).
// Billing stops first; training data is removed with the account; payment records are kept
// without a link to the person, as financial records must be.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const admin = createAdminClient();
  const userId = auth.user.id;

  const { data: member } = await admin.from("gym_members").select("role").eq("user_id", userId).maybeSingle();
  if (member?.role === "owner") {
    return NextResponse.json({ error: "owner_account", message: "Transfer ownership of the gym before deleting this account." }, { status: 409 });
  }

  const { data: subscriptions } = await admin.from("memberships").select("stripe_subscription_id").eq("user_id", userId).not("stripe_subscription_id", "is", null).in("status", ["active", "past_due", "frozen"]);
  if (subscriptions?.length) {
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: "payments_not_configured", message: "Contact the gym to cancel your membership first." }, { status: 503 });
    try {
      for (const s of subscriptions) await stripe.subscriptions.cancel(s.stripe_subscription_id!);
    } catch (error) {
      console.error("could not cancel subscription before account deletion", error);
      return NextResponse.json({ error: "cancel_failed", message: "We could not cancel your membership billing. Nothing was deleted — please try again." }, { status: 502 });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
