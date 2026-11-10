import { notFound } from "next/navigation";
import { ProgramPurchase } from "@/components/checkout-button";
import { Card, LinkButton, TrackDot } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { addDays, money, todayInZone } from "@/lib/format";
import { createPublicClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/programs/[slug]">) {
  const { slug } = await params;
  const { data } = await createPublicClient().from("programs").select("name, summary").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Program", description: data?.summary ?? undefined };
}

export default async function ProgramPage({ params }: PageProps<"/programs/[slug]">) {
  const { slug } = await params;
  const supabase = createPublicClient();
  const [{ data: program }, { data: gym }] = await Promise.all([
    supabase.from("programs").select("*, tracks(name, color)").eq("slug", slug).maybeSingle(),
    supabase.from("gyms").select("timezone").eq("is_default", true).single(),
  ]);
  if (!program) notFound();

  const viewer = await getViewer();
  const today = todayInZone(gym?.timezone ?? "UTC");
  let enrolled = false;
  if (viewer) {
    const { data } = await viewer.supabase.from("enrollments").select("id").eq("program_id", program.id).eq("user_id", viewer.user.id).eq("status", "active").maybeSingle();
    enrolled = Boolean(data);
  }
  const unlock = { weekly: "Each week unlocks on its first day.", daily: "Each session unlocks on its day.", all: "Every session is available from day one." }[program.unlock_mode];

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted"><TrackDot color={program.tracks?.color} />{program.tracks?.name ?? "Fury Co."} program</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{program.name}</h1>
      <p className="mt-2 text-muted">{program.summary}</p>
      <dl className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-[20px] bg-surface p-3.5"><dt className="text-xs text-muted">Length</dt><dd className="font-semibold">{program.duration_weeks} weeks</dd></div>
        <div className="rounded-[20px] bg-surface p-3.5"><dt className="text-xs text-muted">Sessions</dt><dd className="font-semibold">{program.days_per_week} a week</dd></div>
        <div className="rounded-[20px] bg-surface p-3.5"><dt className="text-xs text-muted">Price</dt><dd className="font-semibold">{money(program.price_cents, program.currency)}</dd></div>
      </dl>
      {program.description ? <p className="mt-6 whitespace-pre-line text-sm leading-relaxed">{program.description}</p> : null}
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Start on any date you choose — your calendar is built from your own start date.</li>
        <li>{unlock} Missed sessions stay available.</li>
        <li>Access continues for {program.grace_days} days after the final week.</li>
        <li>Follow and log every session in the Fury Co. app.</li>
      </ul>

      <Card className="mt-8">
        {enrolled ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">You are enrolled. Open the Fury Co. app to train.</p>
            <LinkButton href="/account">Your account</LinkButton>
          </div>
        ) : viewer ? (
          <ProgramPurchase programId={program.id} today={today} maxDate={addDays(today, 90)} priceLabel={money(program.price_cents, program.currency)} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Create an account or sign in to enrol.</p>
            <span className="flex gap-2">
              <LinkButton href={`/join?next=/programs/${program.slug}`} variant="primary">Create account</LinkButton>
              <LinkButton href={`/login?next=/programs/${program.slug}`}>Sign in</LinkButton>
            </span>
          </div>
        )}
      </Card>
    </main>
  );
}
