import { getLegal, LegalPage, LegalPending } from "@/components/legal";

export const metadata = { title: "Terms of service" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { gymName, legal } = await getLegal();
  return (
    <LegalPage gymName={gymName} title="Terms of service" updatedAt={legal?.terms ? legal.updated_at : null}>
      {legal?.terms || <LegalPending what="Our terms of service" email={legal?.support_email} />}
    </LegalPage>
  );
}
