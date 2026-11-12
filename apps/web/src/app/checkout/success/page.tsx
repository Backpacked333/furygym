import { LinkButton } from "@/components/ui";
import { env } from "@/lib/env";
import { ReturnToApp } from "./return-to-app";

export const metadata = { title: "Thank you", robots: { index: false } };

export default async function CheckoutSuccess({ searchParams }: PageProps<"/checkout/success">) {
  const params = await searchParams;
  const toApp = params.return === "app";
  const fromPortal = params.portal === "1";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center px-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Fury Co. Athletics</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{fromPortal ? "All set" : "You're in"}</h1>
      <p className="mt-2 text-sm text-muted">
        {fromPortal
          ? "Your billing details are up to date."
          : "Payment received. Your access is being switched on and will appear in the app within a few seconds. A receipt is on its way by email."}
      </p>
      {toApp ? <ReturnToApp href={`${env.iosAppScheme}://checkout/success`} /> : <LinkButton href="/account" variant="primary" className="mt-6">Go to your account</LinkButton>}
    </main>
  );
}
