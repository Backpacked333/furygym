import { LinkButton } from "@/components/ui";
import { env } from "@/lib/env";

export const metadata = { title: "Checkout cancelled", robots: { index: false } };

export default async function CheckoutCancelled({ searchParams }: PageProps<"/checkout/cancelled">) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout cancelled</h1>
      <p className="mt-2 text-sm text-muted">Nothing was charged.</p>
      {params.return === "app" ? (
        <a href={`${env.iosAppScheme}://checkout/cancelled`} className="mt-6 inline-flex btn-filled rounded-full px-5 py-2.5 text-[15px] font-semibold text-white">Return to the Fury Co. app</a>
      ) : (
        <LinkButton href="/account" className="mt-6">Back to your account</LinkButton>
      )}
    </main>
  );
}
