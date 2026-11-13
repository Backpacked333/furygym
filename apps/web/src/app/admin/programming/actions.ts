"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fail, text, type ActionState } from "@/lib/action";
import { requireStaff } from "@/lib/auth";
import { zonedToUtc } from "@/lib/format";
import { workoutSchema } from "@/lib/workouts";

export async function saveWorkout(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym, user } = await requireStaff();

  let raw: unknown;
  try {
    raw = JSON.parse(text(form, "payload"));
  } catch {
    return fail("The form could not be read. Reload and try again.");
  }
  const parsed = workoutSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const input = parsed.data;

  for (const item of input.items) {
    if (item.metrics.includes("benchmark") && item.metrics.length === 1) {
      return fail(`"${item.title}" is a benchmark: also pick what is measured (time, reps or load).`);
    }
  }

  let existing: { status: string; publish_at: string | null } | null = null;
  if (input.id) {
    const { data } = await supabase.from("workouts").select("status, publish_at").eq("id", input.id).single();
    existing = data;
  }

  let status: "draft" | "published" = "draft";
  let publishAt: string | null = null;
  if (input.publish === "now") {
    status = "published";
    // Re-saving a workout that is already live keeps its original publish time.
    const alreadyLive = existing?.status === "published" && existing.publish_at && new Date(existing.publish_at) <= new Date();
    publishAt = alreadyLive ? existing!.publish_at : new Date().toISOString();
  } else if (input.publish === "schedule") {
    if (!input.publish_date || !input.publish_time) return fail("Choose the date and time to publish.");
    status = "published";
    try {
      publishAt = zonedToUtc(input.publish_date, input.publish_time, gym.timezone, "reject").toISOString();
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Choose a valid date and time.");
    }
  }
  if (input.is_template && status === "published") return fail("Templates stay as drafts. Create a workout from the template to publish it.");
  if (status === "published" && input.items.length === 0) return fail("Add at least one block before publishing. Save it as a draft until then.");

  const row = {
    gym_id: gym.id,
    title: input.title,
    track_id: input.track_id ?? null,
    scheduled_date: input.program_id || input.is_template ? null : (input.scheduled_date ?? null),
    description: input.description ?? null,
    coach_notes: input.coach_notes ?? null,
    is_template: input.is_template,
    status,
    publish_at: publishAt,
  };
  if (!row.scheduled_date && !input.program_id && !input.is_template) return fail("Choose the date this workout is for.");

  let workoutId = input.id ?? null;
  if (workoutId) {
    const { error } = await supabase.from("workouts").update(row).eq("id", workoutId);
    if (error) return fail(error);
  } else {
    const { data, error } = await supabase.from("workouts").insert({ ...row, created_by: user.id }).select("id").single();
    if (error || !data) return fail(error);
    workoutId = data.id;
  }

  // Items keep their ids across saves so that athletes' logged results stay attached to them.
  const { data: current } = await supabase.from("workout_items").select("id").eq("workout_id", workoutId);
  const keep = new Set(input.items.map((i) => i.id).filter(Boolean) as string[]);
  const remove = (current ?? []).map((i) => i.id).filter((id) => !keep.has(id));
  if (remove.length) {
    const { error } = await supabase.from("workout_items").delete().in("id", remove);
    if (error) return fail(error);
  }
  for (const [index, item] of input.items.entries()) {
    const itemRow = {
      workout_id: workoutId,
      position: index + 1,
      section: item.section ?? null,
      title: item.title,
      exercise_id: item.exercise_id ?? null,
      prescription: item.prescription ?? null,
      scaling: item.scaling ?? null,
      notes: item.notes ?? null,
      video_url: item.video_url ?? null,
      metrics: item.metrics,
      benchmark_name: item.metrics.includes("benchmark") ? (item.benchmark_name ?? item.title) : null,
    };
    const { error } = item.id
      ? await supabase.from("workout_items").update(itemRow).eq("id", item.id)
      : await supabase.from("workout_items").insert(itemRow);
    if (error) return fail(error);
  }

  if (input.program_id && input.week && input.day) {
    const { error } = await supabase
      .from("program_workouts")
      .upsert({ program_id: input.program_id, week: input.week, day: input.day, workout_id: workoutId }, { onConflict: "program_id,week,day" });
    if (error) return fail(error);
  }

  revalidatePath("/admin/programming");
  if (input.program_id) redirect(`/admin/programs/${input.program_id}`);
  if (input.is_template) redirect("/admin/programming");
  redirect(`/admin/programming?week=${row.scheduled_date}`);
}

export async function deleteWorkout(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const id = text(form, "id");
  const { count } = await supabase.from("workout_logs").select("id", { count: "exact", head: true }).eq("workout_id", id);
  if (count) return fail(`${count} athlete log${count === 1 ? "" : "s"} are attached to this workout. Unpublish it instead of deleting.`);
  const { error } = await supabase.from("workouts").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/admin/programming");
  redirect(text(form, "back") || "/admin/programming");
}

export async function saveExercise(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireStaff();
  const id = text(form, "id");
  const row = {
    gym_id: gym.id,
    name: text(form, "name"),
    category: text(form, "category") || null,
    cues: text(form, "cues") || null,
    video_url: text(form, "video_url") || null,
    default_metrics: form.getAll("default_metrics").map(String) as never,
    archived: form.get("archived") === "on",
  };
  if (!row.name) return fail("Give the exercise a name.");
  const { error } = id ? await supabase.from("exercises").update(row).eq("id", id) : await supabase.from("exercises").insert(row);
  if (error) return fail(error.code === "23505" ? "An exercise with that name already exists." : error);
  revalidatePath("/admin/exercises");
  return { ok: id ? "Saved." : `Added ${row.name}.` };
}
