"use server";

import { revalidatePath } from "next/cache";
import { fail, integer, optional, text, type ActionState } from "@/lib/action";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { addDays, todayInZone, zonedToUtc } from "@/lib/format";

export async function saveSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const id = text(form, "id");
  const row = {
    gym_id: gym.id,
    title: text(form, "title"),
    track_id: optional(form, "track_id"),
    coach_id: optional(form, "coach_id"),
    weekday: integer(form, "weekday") ?? 1,
    start_time: text(form, "start_time"),
    duration_minutes: integer(form, "duration_minutes") ?? 60,
    capacity: integer(form, "capacity") ?? 16,
    active: form.get("active") !== "false",
  };
  if (!row.title || !row.start_time) return fail("A class needs a title and a start time.");
  const { error } = id ? await supabase.from("class_schedules").update(row).eq("id", id) : await supabase.from("class_schedules").insert(row);
  if (error) return fail(error);
  revalidatePath("/admin/schedule");
  return { ok: id ? "Saved." : "Added to the weekly schedule. Generate sessions to make it bookable." };
}

export async function deleteSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("class_schedules").delete().eq("id", text(form, "id"));
  if (error) return fail(error);
  revalidatePath("/admin/schedule");
  return { ok: "Removed. Sessions already generated are unchanged." };
}

export async function generateSessions(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const weeks = Math.min(Math.max(integer(form, "weeks") ?? 4, 1), 12);
  const today = todayInZone(gym.timezone);
  const { data, error } = await supabase.rpc("generate_sessions", { p_gym: gym.id, p_from: today, p_to: addDays(today, weeks * 7) });
  if (error) return fail(error);
  revalidatePath("/admin/schedule");
  return { ok: data ? `Created ${data} new session${data === 1 ? "" : "s"} for the next ${weeks} weeks.` : "Sessions for that period already exist." };
}

export async function addSession(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const date = text(form, "date");
  const time = text(form, "start_time");
  const title = text(form, "title");
  if (!title || !date || !time) return fail("A class needs a title, date and start time.");
  const start = zonedToUtc(date, time, gym.timezone);
  const minutes = integer(form, "duration_minutes") ?? 60;
  const { error } = await supabase.from("class_sessions").insert({
    gym_id: gym.id,
    title,
    track_id: optional(form, "track_id"),
    coach_id: optional(form, "coach_id"),
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    capacity: integer(form, "capacity") ?? 16,
  });
  if (error) return fail(error);
  revalidatePath("/admin/schedule");
  return { ok: "Class added." };
}

export async function updateSession(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const capacity = integer(form, "capacity");
  const patch: { capacity?: number; coach_id?: string | null; notes?: string | null; status?: string } = {
    coach_id: optional(form, "coach_id"),
    notes: optional(form, "notes"),
  };
  if (capacity && capacity > 0) patch.capacity = capacity;
  const status = text(form, "status");
  if (status === "scheduled" || status === "cancelled") patch.status = status;
  const { error } = await supabase.from("class_sessions").update(patch).eq("id", id);
  if (error) return fail(error);
  revalidatePath(`/admin/schedule/sessions/${id}`);
  revalidatePath("/admin/schedule");
  return { ok: patch.status === "cancelled" ? "Class cancelled. Tell booked athletes — notifications are not sent automatically yet." : "Saved." };
}

export async function staffBook(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const session = text(form, "session_id");
  const user = text(form, "user_id");
  if (!user) return fail("Choose a member.");
  const { data, error } = await supabase.rpc("book_class", { p_session: session, p_user: user });
  if (error) return fail(error);
  revalidatePath(`/admin/schedule/sessions/${session}`);
  return { ok: data.status === "waitlisted" ? "Class is full — added to the waitlist." : "Added to the class." };
}

export async function setAttendance(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const status = text(form, "status") as "attended" | "no_show" | "booked";
  const { error } = await supabase.rpc("check_in", { p_booking: text(form, "booking_id"), p_status: status });
  if (error) return fail(error);
  revalidatePath(`/admin/schedule/sessions/${text(form, "session_id")}`);
  return null;
}

export async function staffCancelBooking(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("cancel_booking", { p_booking: text(form, "booking_id") });
  if (error) return fail(error);
  revalidatePath(`/admin/schedule/sessions/${text(form, "session_id")}`);
  return null;
}
