import Link from "next/link";
import { getLegal, LegalPage } from "@/components/legal";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { gymName, legal } = await getLegal();
  return (
    <LegalPage gymName={gymName} title="Support">
      <p>
        {legal?.support_email
          ? <>Email <a className="underline" href={`mailto:${legal.support_email}`}>{legal.support_email}</a> for help with your account, membership, bookings or payments.</>
          : "For help with your account, membership, bookings or payments, ask at the front desk."}
      </p>
      <h2 className="mt-8 text-lg font-semibold">Common questions</h2>
      <p className="mt-2"><span className="font-semibold">I forgot my password.</span> Use <Link href="/login" className="underline">Forgot password</Link> on the sign-in page and follow the link we email you.</p>
      <p className="mt-2"><span className="font-semibold">I want to change my card, freeze or cancel.</span> Open your profile in the app, or <Link href="/account" className="underline">your account</Link> on this website.</p>
      <p className="mt-2"><span className="font-semibold">I want to delete my account.</span> In the app, open your profile and choose Delete account. This stops any billing first and cannot be undone.</p>
    </LegalPage>
  );
}
