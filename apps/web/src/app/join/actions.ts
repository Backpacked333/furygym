"use server";

import { redirect } from "next/navigation";
import { fail, text, type ActionState } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const fullName = text(form, "full_name");
  const email = text(form, "email");
  const password = form.get("password");
  if (fullName.length < 2) return fail("Enter your full name.");
  if (typeof password !== "string" || password.length < 8) return fail("Choose a password of at least 8 characters.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) return fail(error.message);
  if (!data.session) return { ok: "Check your email to confirm your address, then sign in." };

  const next = text(form, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/admin") ? next : "/account");
}
