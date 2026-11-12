"use server";

import { revalidatePath } from "next/cache";
import { fail, text, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";

export async function signWaiver(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  if (form.get("agree") !== "on") return fail("Tick the box to confirm you have read and agree.");
  const { error } = await supabase.rpc("sign_waiver", { p_waiver: text(form, "waiver_id"), p_signed_name: text(form, "signed_name") });
  if (error) return fail(error.message === "signature_required" ? "Type your full name to sign." : error);
  revalidatePath("/account");
  return { ok: "Signed. Thank you." };
}

export async function changeStartDate(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("set_enrollment_start", { p_enrollment: text(form, "id"), p_start: text(form, "start_date") });
  if (error) {
    const messages: Record<string, string> = {
      program_already_started: "Your program has already started. Ask a coach if you need to move it.",
      start_date_in_past: "Choose today or a later date.",
      start_date_too_far: "Choose a date within the next 90 days.",
    };
    return fail(messages[error.message] ?? error);
  }
  revalidatePath("/account");
  return { ok: "Start date updated." };
}
