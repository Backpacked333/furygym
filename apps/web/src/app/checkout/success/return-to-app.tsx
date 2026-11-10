"use client";

import { useEffect } from "react";

/** Hands control back to the iOS app. The button is the fallback if the automatic return is blocked. */
export function ReturnToApp({ href }: { href: string }) {
  useEffect(() => {
    const timer = setTimeout(() => window.location.assign(href), 600);
    return () => clearTimeout(timer);
  }, [href]);
  return (
    <a href={href} className="mt-6 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
      Return to the Fury Co. app
    </a>
  );
}
