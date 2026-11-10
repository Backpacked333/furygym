"use server";

import { revalidatePath } from "next/cache";
import { cents, checked, fail, integer, optional, text, type ActionState } from "@/lib/action";
import { requireAdmin } from "@/lib/auth";

export async function savePlan(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const id = text(form, "id");
  const kind = text(form, "kind") as "recurring" | "class_pack" | "drop_in" | "intro";
  const price = cents(form, "price");
  const name = text(form, "name");
  if (!name) return fail("Give the plan a name.");
  if (price == null) return fail("Enter a price.");

  const credits = integer(form, "class_credits");
  const days = integer(form, "duration_days");
  if (kind === "class_pack" && !credits) return fail("A class pack needs a number of classes.");
  if (kind !== "recurring" && !days) return fail("Enter how many days this plan is valid for.");

  const row = {
    gym_id: gym.id,
    name,
    description: optional(form, "description"),
    kind,
    price_cents: price,
    billing_interval: kind === "recurring" ? (text(form, "billing_interval") || "month") : null,
    class_credits: kind === "recurring" || kind === "intro" ? null : kind === "drop_in" ? 1 : credits,
    duration_days: kind === "recurring" ? null : days,
    stripe_price_id: optional(form, "stripe_price_id"),
    active: id ? checked(form, "active") : true,
    is_public: id ? checked(form, "is_public") : true,
    position: integer(form, "position") ?? 0,
  };
  const { error } = id ? await supabase.from("membership_plans").update(row).eq("id", id) : await supabase.from("membership_plans").insert(row);
  if (error) return fail(error);
  revalidatePath("/admin/plans");
  return { ok: id ? "Plan saved. Existing members keep the price they signed up at." : `${name} created.` };
}

/** Publishes a new waiver version. Members who signed an earlier version must sign again. */
export async function publishWaiver(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title || body.length < 20) return fail("Enter a title and the full agreement text.");
  const { data: latest } = await supabase.from("waivers").select("version").eq("gym_id", gym.id).order("version", { ascending: false }).limit(1).maybeSingle();

  const { error: retire } = await supabase.from("waivers").update({ active: false }).eq("gym_id", gym.id).eq("active", true);
  if (retire) return fail(retire);
  const { error } = await supabase.from("waivers").insert({ gym_id: gym.id, title, body, version: (latest?.version ?? 0) + 1 });
  if (error) return fail(error);
  revalidatePath("/admin/plans");
  return { ok: "New version published. Members will be asked to sign it before their next booking." };
}

export async function saveGymSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const timezone = text(form, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return fail("That is not a recognised timezone. Use a name like America/Chicago.");
  }
  const { error } = await supabase
    .from("gyms")
    .update({
      name: text(form, "name") || gym.name,
      timezone,
      booking_window_days: integer(form, "booking_window_days") ?? gym.booking_window_days,
      cancel_cutoff_minutes: integer(form, "cancel_cutoff_minutes") ?? gym.cancel_cutoff_minutes,
      ios_program_purchase_link: checked(form, "ios_program_purchase_link"),
    })
    .eq("id", gym.id);
  if (error) return fail(error);
  revalidatePath("/admin", "layout");
  return { ok: "Settings saved." };
}
