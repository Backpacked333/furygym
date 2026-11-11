import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { sendPasswordReset, signIn } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, password, confirmation } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
      {password === "updated" ? <p role="status" className="mt-3 text-sm text-good">Password updated. Sign in with your new password.</p> : null}
      {confirmation === "complete" ? <p role="status" className="mt-3 text-sm text-good">Email confirmed. Sign in on the web or in the Fury Co. app.</p> : null}
      {confirmation === "invalid" ? <p role="alert" className="mt-3 text-sm text-bad">This confirmation link is invalid, expired or already used. Try signing in, or request a new email by signing up again.</p> : null}
      <ActionForm action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={typeof next === "string" ? next : ""} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full">Sign in</SubmitButton>
      </ActionForm>
      <details className="mt-6 text-sm text-muted">
        <summary className="cursor-pointer">Forgot your password?</summary>
        <p className="mt-3">Open the reset email link in this same browser.</p>
        <ActionForm action={sendPasswordReset} className="mt-3 space-y-3">
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <SubmitButton variant="secondary">Email me a reset link</SubmitButton>
        </ActionForm>
      </details>
      <p className="mt-8 text-sm text-muted">
        New here? <Link href="/join" className="text-ink underline">Create an account</Link>
      </p>
    </main>
  );
}
