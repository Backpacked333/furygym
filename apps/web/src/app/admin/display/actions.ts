"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { checked, fail, optional, text, type ActionState } from "@/lib/action";
import { requireAdmin, requireStaff } from "@/lib/auth";

export async function saveDisplay(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym, user } = await requireStaff();
  const mode = text(form, "mode") as "auto" | "manual" | "off";
  const workoutId = optional(form, "workout_id");
  if (mode === "manual" && !workoutId && !optional(form, "message")) return fail("Choose a workout to pin, or enter a message.");
  const { error } = await supabase
    .from("display_state")
    .update({
      mode,
      track_id: mode === "auto" ? optional(form, "track_id") : null,
      workout_id: mode === "manual" ? workoutId : null,
      message: optional(form, "message"),
      show_coach_notes: checked(form, "show_coach_notes"),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("gym_id", gym.id);
  if (error) return fail(error);
  revalidatePath("/admin/display");
  return { ok: "Display updated. Screens refresh within 30 seconds." };
}

/** Issues a new display link. Every screen using the old link stops working. */
export async function rotateDisplayToken(): Promise<ActionState> {
  const { supabase, gym } = await requireAdmin();
  const { error } = await supabase
    .from("gym_secrets")
    .update({ display_token: randomBytes(24).toString("hex"), updated_at: new Date().toISOString() })
    .eq("gym_id", gym.id);
  if (error) return fail(error);
  revalidatePath("/admin/display");
  return { ok: "New link created. Update the address on each screen." };
}
