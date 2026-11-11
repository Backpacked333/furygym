import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("freeze"), membership_id: z.string().uuid(), weeks: z.union([z.literal(2), z.literal(4), z.literal(8)]) }),
  z.object({ action: z.literal("resume"), membership_id: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), membership_id: z.string().uuid() }),
]);

const refuse = (error: string, status: number, message: string) => NextResponse.json({ error, message }, { status });

// Athlete self-service for their own membership: freeze, resume, or cancel at the end of the
// paid period. Billing changes first; failures after that require reconciliation.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return refuse("not_authenticated", 401, "Please sign in again.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid_request", 400, "That request could not be read.");
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: membership } = await admin.from("memberships").select("*, membership_plans(kind)").eq("id", input.membership_id).eq("user_id", auth.user.id).maybeSingle();
  if (!membership) return refuse("not_found", 404, "Membership not found.");
  if (membership.membership_plans?.kind !== "recurring" && input.action !== "cancel") {
    return refuse("not_supported", 409, "Only recurring memberships can be frozen.");
  }
  if (membership.membership_plans?.kind !== "recurring" && input.action === "cancel") {
    return NextResponse.json({ ok: true, message: "This pass does not renew. Your remaining credits and existing expiry are unchanged." });
  }

  const subscriptionId = membership.stripe_subscription_id;
  const stripe = getStripe();
  if (subscriptionId && !stripe) return refuse("payments_not_configured", 503, "Contact the gym to change this membership.");

  let billingChanged = false;
  try {
    if (input.action === "freeze") {
      if (!["active", "past_due"].includes(membership.status)) return refuse("not_active", 409, "This membership is not active.");
      const { data: today } = await admin.rpc("gym_today", { p_gym: membership.gym_id });
      const until = new Date(`${today}T00:00:00Z`);
      until.setUTCDate(until.getUTCDate() + input.weeks * 7);
      const untilDate = until.toISOString().slice(0, 10);
      if (subscriptionId) {
        await stripe!.subscriptions.update(subscriptionId, { pause_collection: { behavior: "void", resumes_at: Math.floor(new Date(`${untilDate}T12:00:00Z`).getTime() / 1000) } });
        billingChanged = true;
      }
      const { data, error } = await admin.rpc("freeze_membership", { p_user: auth.user.id, p_membership: membership.id, p_until: untilDate });
      if (error) return refuse("freeze_failed", 409, billingChanged ? "Billing was paused, but bookings could not be updated. Contact the gym before retrying." : "This membership could not be frozen.");
      return NextResponse.json({ ok: true, ...(data as object) });
    }

    if (input.action === "resume") {
      if (membership.status !== "frozen") return refuse("not_frozen", 409, "This membership is not frozen.");
      if (subscriptionId) {
        await stripe!.subscriptions.update(subscriptionId, { pause_collection: null });
        billingChanged = true;
      }
      const { error } = await admin.from("memberships").update({ status: "active", frozen_until: null }).eq("id", membership.id);
      if (error) throw new Error("Membership update failed");
      return NextResponse.json({ ok: true });
    }

    // cancel: stop renewing, keep access until the end of what has been paid for
    if (!["active", "past_due", "frozen"].includes(membership.status)) return refuse("not_active", 409, "This membership has already ended.");
    if (subscriptionId) {
      await stripe!.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      billingChanged = true;
      const { error } = await admin.from("memberships").update({ cancel_at_period_end: true, ends_at: membership.current_period_end }).eq("id", membership.id);
      if (error) throw new Error("Membership update failed");
    } else {
      const endsAt = membership.current_period_end ?? membership.ends_at;
      if (!endsAt) return refuse("no_paid_period", 409, "This membership has no renewal or paid-through date. Contact the gym to arrange an end date.");
      const { error } = await admin.from("memberships").update({ cancel_at_period_end: true, ends_at: endsAt, status: new Date(endsAt) <= new Date() ? "cancelled" : membership.status }).eq("id", membership.id);
      if (error) throw new Error("Membership update failed");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("membership change failed", error);
    return refuse("membership_change_failed", 502, billingChanged ? "Billing was updated, but the app could not refresh your membership. Contact the gym before retrying." : "We could not update this membership. Please try again or contact the gym.");
  }
}
