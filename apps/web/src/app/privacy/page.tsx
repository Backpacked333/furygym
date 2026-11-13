import { getLegal, LegalPage, LegalPending } from "@/components/legal";

export const metadata = { title: "Privacy policy" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { gymName, legal } = await getLegal();
  return (
    <LegalPage gymName={gymName} title="Privacy policy" updatedAt={legal?.privacy_policy ? legal.updated_at : null}>
      {legal?.privacy_policy || <LegalPending what="Our privacy policy" email={legal?.support_email} />}
    </LegalPage>
  );
}
