"use server";

import { redirect } from "next/navigation";
import { fail, text, type ActionState } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: text(form, "email"),
    password: typeof form.get("password") === "string" ? form.get("password") as string : "",
  });
  // Supabase only reports this after the password has matched, so it gives nothing away.
  if (error?.code === "email_not_confirmed") return fail("Confirm your email first: open the link we sent when you signed up. Signing up again sends a new link.");
  if (error || !data.user) return fail("That email and password do not match an account.");

  const { data: member } = await supabase.from("gym_members").select("role").eq("user_id", data.user.id).maybeSingle();
  const next = text(form, "next");
  const isStaff = member && member.role !== "athlete";
  // Only follow same-site paths, and never send an athlete into the staff console.
  const safeNext = next.startsWith("/") && !next.startsWith("//") && (isStaff || !next.startsWith("/admin")) ? next : null;
  redirect(safeNext ?? (isStaff ? "/admin" : "/account"));
}

export async function sendPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, "email");
  if (!email) return fail("Enter your email address first.");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.siteUrl}/auth/callback`,
  });
  if (error) return fail("We couldn't send a reset link right now. Please try again later.");
  // Same answer whether or not the account exists.
  return { ok: "If that email has an account, a reset link is on its way." };
}
