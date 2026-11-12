"use server";

import { redirect } from "next/navigation";
import { fail, type ActionState } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const password = form.get("password");
  if (typeof password !== "string" || password.length < 8) return fail("Choose a password of at least 8 characters.");
  if (password !== form.get("confirm_password")) return fail("The passwords do not match.");

  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) return fail("Your reset session has expired. Request a new reset link.");
  if (form.get("user_id") !== data.user.id) return fail("Your account changed. Reopen your reset link or request a new one.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail("Your password could not be changed. Try a different password or request a new reset link.");
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) return fail("Your password has changed, but we couldn't sign you out. Sign in again with your new password.");
  redirect("/login?password=updated");
}
