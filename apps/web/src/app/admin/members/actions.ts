"use server";

import { revalidatePath } from "next/cache";
import { fail, integer, text, type ActionState } from "@/lib/action";
import { requireAdmin, requireStaff, type GymRole } from "@/lib/auth";
import { PAYMENTS_OFF, getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/format";

export async function setRole(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym, user, role: myRole } = await requireAdmin();
  const userId = text(form, "user_id");
  const role = text(form, "role") as GymRole;
  if (!["athlete", "coach", "admin", "owner"].includes(role)) return fail("Unknown role.");
  if (userId === user.id) return fail("You cannot change your own role.");
  if (role === "owner" && myRole !== "owner") return fail("Only an owner can make someone an owner.");

  const { data, error } = await supabase.from("gym_members").update({ role }).eq("gym_id", gym.id).eq("user_id", userId).select();
  if (error) return fail(error);
  if (!data?.length) return fail("Only an owner can change an owner's role.");
  revalidatePath(`/admin/members/${userId}`);
  return { ok: "Role updated." };
}

/** Grants a membership without payment: comps, staff, or members carried over from Wodify. */
export async function grantMembership(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const userId = text(form, "user_id");
  const { data: plan } = await supabase.from("membership_plans").select("*").eq("id", text(form, "plan_id")).single();
  if (!plan) return fail("Choose a plan.");

  const endsAt = plan.duration_days ? new Date(Date.now() + plan.duration_days * 86_400_000).toISOString() : null;
  const { error } = await supabase.from("memberships").insert({
    gym_id: gym.id,
    user_id: userId,
    plan_id: plan.id,
    source: text(form, "source") === "migrated" ? "migrated" : "comp",
    credits_remaining: plan.class_credits,
    ends_at: endsAt,
  });
  if (error) return fail(error);
  revalidatePath(`/admin/members/${userId}`);
  return { ok: `${plan.name} added.` };
}

export async function updateMembership(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const op = text(form, "op");
  const { data: membership } = await supabase.from("memberships").select("*").eq("id", id).single();
  if (!membership) return fail("Membership not found.");

  const stripe = getStripe();
  const subscriptionId = membership.stripe_subscription_id;
  if (subscriptionId && !stripe) return fail(PAYMENTS_OFF);

  try {
    if (op === "cancel_at_period_end") {
      // Billing stops at the end of the period the member has already paid for.
      const endsAt = membership.current_period_end ?? membership.ends_at;
      if (!endsAt) return fail("There is no paid-through date. Set one or use Cancel now to end access immediately.");
      if (subscriptionId) await stripe!.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      const patch = { cancel_at_period_end: true, ends_at: endsAt };
      const { error } = await supabase.from("memberships").update(patch).eq("id", id);
      if (error) return fail(error);
    } else if (op === "cancel_now") {
      if (subscriptionId) await stripe!.subscriptions.cancel(subscriptionId);
      const { error } = await supabase.from("memberships").update({ status: "cancelled", ends_at: new Date().toISOString() }).eq("id", id);
      if (error) return fail(error);
    } else if (op === "freeze") {
      const until = text(form, "frozen_until");
      const { data: today, error: dateError } = await supabase.rpc("gym_today", { p_gym: membership.gym_id });
      if (dateError || !today) return fail("The gym date could not be loaded. Please try again.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < addDays(today, 7) || until > addDays(today, 92)) {
        return fail("Choose a freeze end date between 7 and 92 days from today.");
      }
      if (!["active", "past_due"].includes(membership.status)) return fail("This membership is not active.");
      if (subscriptionId) {
        await stripe!.subscriptions.update(subscriptionId, {
          pause_collection: { behavior: "void", ...(until ? { resumes_at: Math.floor(new Date(`${until}T12:00:00Z`).getTime() / 1000) } : {}) },
        });
      }
      const { error } = await createAdminClient().rpc("freeze_membership", { p_user: membership.user_id, p_membership: id, p_until: until });
      if (error) return fail(subscriptionId ? "Billing was paused, but bookings could not be updated. Contact the gym before retrying." : error);
    } else if (op === "unfreeze") {
      if (subscriptionId) await stripe!.subscriptions.update(subscriptionId, { pause_collection: null });
      const { error } = await supabase.from("memberships").update({ status: "active", frozen_until: null }).eq("id", id);
      if (error) return fail(error);
    } else if (op === "set_credits") {
      const credits = integer(form, "credits");
      if (credits == null || credits < 0) return fail("Enter a number of credits.");
      const { error } = await supabase.from("memberships").update({ credits_remaining: credits }).eq("id", id);
      if (error) return fail(error);
    } else {
      return fail("Unknown action.");
    }
  } catch (error) {
    return fail(error instanceof Error ? `Stripe: ${error.message}` : "Stripe request failed.");
  }

  revalidatePath(`/admin/members/${membership.user_id}`);
  return { ok: "Membership updated." };
}

export async function refundPayment(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const { data: payment } = await supabase.from("payments").select("*").eq("id", text(form, "id")).single();
  if (!payment) return fail("Payment not found.");
  if (!payment.stripe_payment_intent_id) return fail("This payment was not taken through Stripe.");
  const stripe = getStripe();
  if (!stripe) return fail(PAYMENTS_OFF);
  try {
    await stripe.refunds.create({ payment_intent: payment.stripe_payment_intent_id });
  } catch (error) {
    return fail(error instanceof Error ? `Stripe: ${error.message}` : "Refund failed.");
  }
  if (payment.user_id) revalidatePath(`/admin/members/${payment.user_id}`);
  // The payment row, and any membership or enrollment it paid for, update when Stripe's webhook arrives.
  return { ok: "Refund sent to Stripe. This page updates once Stripe confirms it." };
}

export async function addFeedback(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user } = await requireStaff();
  const body = text(form, "body");
  if (!body) return fail("Write a note first.");
  const { error } = await supabase.from("coach_feedback").insert({ log_id: text(form, "log_id"), coach_id: user.id, body });
  if (error) return fail(error);
  revalidatePath(`/admin/members/${text(form, "user_id")}`);
  return { ok: "Feedback sent." };
}
