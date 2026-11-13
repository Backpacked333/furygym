import { LinkButton } from "@/components/ui";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 text-muted">That link is out of date or was mistyped.</p>
      <div className="mt-6">
        <LinkButton href="/" variant="primary">Back to start</LinkButton>
      </div>
    </main>
  );
}
