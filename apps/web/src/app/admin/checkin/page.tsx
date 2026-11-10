import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Scanner } from "./scanner";

export const metadata = { title: "Check-in" };

export default async function CheckInPage() {
  const { gym } = await requireStaff();
  return (
    <>
      <PageHeader eyebrow="Facility" title="Check-in" description="Scan an athlete’s code to check them in to the class they booked. Codes change every 30 seconds, so a screenshot will not work." />
      <Scanner timeZone={gym.timezone} />
    </>
  );
}
