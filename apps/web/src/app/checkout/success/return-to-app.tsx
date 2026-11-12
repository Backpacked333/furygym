"use client";

import { useEffect } from "react";

/** Hands control back to the iOS app. The button is the fallback if the automatic return is blocked. */
export function ReturnToApp({ href }: { href: string }) {
  useEffect(() => {
    const timer = setTimeout(() => window.location.assign(href), 600);
    return () => clearTimeout(timer);
  }, [href]);
  return (
    <a href={href} className="mt-6 inline-flex btn-filled rounded-full px-5 py-2.5 text-[15px] font-semibold text-white">
      Return to the Fury Co. app
    </a>
  );
}
