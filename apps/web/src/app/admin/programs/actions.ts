"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cents, fail, integer, optional, text, type ActionState } from "@/lib/action";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { todayInZone } from "@/lib/format";

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function saveProgram(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireStaff();
  const id = text(form, "id");
  const name = text(form, "name");
  const weeks = integer(form, "duration_weeks");
  const days = integer(form, "days_per_week");
  const price = cents(form, "price");
  if (!name) return fail("Give the program a name.");
  if (!weeks || weeks < 1 || weeks > 104) return fail("Duration must be between 1 and 104 weeks.");
  if (!days || days < 1 || days > 7) return fail("Days per week must be between 1 and 7.");
  if (price == null) return fail("Enter a price (0 for free).");

  const row = {
    gym_id: gym.id,
    name,
    slug: slugify(text(form, "slug") || name),
    track_id: optional(form, "track_id"),
    summary: optional(form, "summary"),
    description: optional(form, "description"),
    duration_weeks: weeks,
    days_per_week: days,
    price_cents: price,
    unlock_mode: (text(form, "unlock_mode") || "weekly") as "weekly" | "daily" | "all",
    grace_days: integer(form, "grace_days") ?? 14,
    status: (text(form, "status") || "draft") as "draft" | "published" | "archived",
    stripe_price_id: optional(form, "stripe_price_id"),
  };

  if (id) {
    if (row.status === "published") {
      const { count } = await supabase.from("program_workouts").select("id", { count: "exact", head: true }).eq("program_id", id);
      if (!count) return fail("Add at least one workout before publishing the program.");
    }
    const { error } = await supabase.from("programs").update(row).eq("id", id);
    if (error) return fail(error.code === "23505" ? "Another program already uses that URL name." : error);
    revalidatePath(`/admin/programs/${id}`);
    return { ok: "Program saved." };
  }
  const { data, error } = await supabase.from("programs").insert({ ...row, status: "draft" }).select("id").single();
  if (error || !data) return fail(error?.code === "23505" ? "Another program already uses that name." : error);
  redirect(`/admin/programs/${data.id}`);
}

/** Publishes every draft workout in the program so enrolled athletes see them as weeks unlock. */
export async function publishProgramWorkouts(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const id = text(form, "id");
  const { data: placed } = await supabase.from("program_workouts").select("workout_id").eq("program_id", id);
  const ids = (placed ?? []).map((p) => p.workout_id);
  if (!ids.length) return fail("This program has no workouts yet.");
  const { data, error } = await supabase
    .from("workouts")
    .update({ status: "published", publish_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "draft")
    .select("id");
  if (error) return fail(error);
  revalidatePath(`/admin/programs/${id}`);
  return { ok: data?.length ? `Published ${data.length} workout${data.length === 1 ? "" : "s"}.` : "Every workout was already published." };
}

export async function removeProgramWorkout(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const programId = text(form, "program_id");
  const workoutId = text(form, "workout_id");
  const { count } = await supabase.from("workout_logs").select("id", { count: "exact", head: true }).eq("workout_id", workoutId);
  if (count) return fail("Athletes have logged this workout, so it cannot be removed. Edit it instead.");
  const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
  if (error) return fail(error);
  revalidatePath(`/admin/programs/${programId}`);
  return { ok: "Removed." };
}

export async function enrollAthlete(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const programId = text(form, "program_id");
  const userId = text(form, "user_id");
  const start = text(form, "start_date") || todayInZone(gym.timezone);
  if (!userId) return fail("Choose an athlete.");
  const { error } = await supabase.from("enrollments").insert({ gym_id: gym.id, program_id: programId, user_id: userId, start_date: start, source: "comp" });
  if (error) return fail(error.code === "23505" ? "That athlete is already enrolled in this program." : error);
  revalidatePath(`/admin/programs/${programId}`);
  revalidatePath(`/admin/members/${userId}`);
  return { ok: "Enrolled." };
}

export async function updateEnrollment(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const start = text(form, "start_date");
  const expires = text(form, "expires_at");
  const status = text(form, "status");

  const { data: current } = await supabase.from("enrollments").select("*").eq("id", id).single();
  if (!current) return fail("Enrollment not found.");

  if (start && start !== current.start_date) {
    // Moving the start carries the expiry with it.
    const { error } = await supabase.rpc("set_enrollment_start", { p_enrollment: id, p_start: start });
    if (error) return fail(error);
  }
  const patch: { expires_at?: string; status?: typeof current.status } = {};
  if (expires && expires !== current.expires_at) patch.expires_at = expires;
  if (status && status !== current.status) patch.status = status as typeof current.status;
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("enrollments").update(patch).eq("id", id);
    if (error) return fail(error);
  }
  revalidatePath(`/admin/programs/${current.program_id}`);
  revalidatePath(`/admin/members/${current.user_id}`);
  return { ok: "Enrollment updated." };
}
