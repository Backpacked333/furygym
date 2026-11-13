"use server";

import { revalidatePath } from "next/cache";
import { fail, text, type ActionState } from "@/lib/action";
import { requireStaff } from "@/lib/auth";

/** Records that an athlete was handed the reward for the attendance milestone they have reached. */
export async function markRewardGiven(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, gym, user } = await requireStaff();
  const userId = text(form, "user_id");
  const { data: due, error: dueError } = await supabase.rpc("milestones_due", { p_gym: gym.id });
  if (dueError) return fail(dueError);
  const row = (due ?? []).find((d) => d.user_id === userId);
  if (!row) return fail("That reward has already been recorded.");
  const { error } = await supabase.from("milestone_rewards").insert({ gym_id: gym.id, user_id: userId, visits: row.milestone, reward: gym.milestone_reward, given_by: user.id });
  if (error) return fail(error.code === "23505" ? "That reward has already been recorded." : error);
  revalidatePath("/admin");
  return null;
}
