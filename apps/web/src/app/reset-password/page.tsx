import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { sendPasswordReset } from "../login/actions";
import { updatePassword } from "./actions";

export const metadata = { title: "Reset password", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { error, request } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const canUpdate = user && !error && request !== "1";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{canUpdate ? "Choose a new password" : "Reset your password"}</h1>
      {canUpdate ? (
        <>
          <p className="mt-3 text-sm text-muted">Updating the password for {user.email}. Then sign in again on the web or in the Fury Co. app.</p>
          <ActionForm action={updatePassword} className="mt-6 space-y-4" resetOnSuccess={false}>
            <input type="hidden" name="user_id" value={user.id} />
            <Field label="New password"><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
            <Field label="Confirm new password"><Input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required /></Field>
            <SubmitButton className="w-full">Update password</SubmitButton>
          </ActionForm>
          <Link href="/reset-password?request=1" className="mt-4 text-sm text-ink underline">Use a different account</Link>
        </>
      ) : (
        <>
          {error ? <p role="alert" className="mt-3 text-sm text-bad">This reset link is invalid, expired, already used, or was opened in a different browser. Request a new link below.</p> : null}
          <p className="mt-3 text-sm text-muted">Open the email link in this same browser. After changing your password, use it to sign in on the web or in the Fury Co. app.</p>
          <ActionForm action={sendPasswordReset} className="mt-6 space-y-4">
            <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
            <SubmitButton className="w-full">Email me a reset link</SubmitButton>
          </ActionForm>
        </>
      )}
      <Link href="/login" className="mt-8 text-sm text-ink underline">Back to sign in</Link>
    </main>
  );
}
