import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { signUp } from "./actions";

export const metadata = { title: "Create an account" };

export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">One account for the gym, online programs and the app.</p>
      <ActionForm action={signUp} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={typeof next === "string" ? next : ""} />
        <Field label="Full name"><Input name="full_name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <SubmitButton className="w-full">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-8 text-sm text-muted">Already have one? <Link href="/login" className="text-ink underline">Sign in</Link></p>
    </main>
  );
}
