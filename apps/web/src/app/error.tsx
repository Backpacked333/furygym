"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">This page could not load</h1>
      <p className="mt-3 text-muted">Nothing was saved or changed. Check the connection and try again.</p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" onClick={() => retry()}>Try again</Button>
        <LinkButton href="/">Back to start</LinkButton>
      </div>
    </main>
  );
}
