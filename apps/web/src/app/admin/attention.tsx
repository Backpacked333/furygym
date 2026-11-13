import Link from "next/link";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Card, Empty } from "@/components/ui";
import type { requireStaff } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, todayInZone } from "@/lib/format";
import { getStripe } from "@/lib/stripe/client";
import { markRewardGiven } from "./actions";

type Viewer = Awaited<ReturnType<typeof requireStaff>>;
const QUIET_DAYS = 14;
const SHOWN = 5;

/**
 * The steps that take an empty gym to one athletes can use. It ticks itself off from what exists and
 * goes away once the required steps are done; taking payments is optional during a pilot.
 */
export async function SetupChecklist({ supabase }: Pick<Viewer, "supabase">) {
  const head = { count: "exact", head: true } as const;
  const [waiver, plans, classes, exercises, workouts, screen] = await Promise.all([
    supabase.from("waivers").select("id", head).eq("active", true),
    supabase.from("membership_plans").select("id", head).eq("active", true),
    supabase.from("class_sessions").select("id", head),
    supabase.from("exercises").select("id", head),
    supabase.from("workouts").select("id", head).eq("status", "published").eq("is_template", false),
    supabase.from("gym_secrets").select("display_seen_at").maybeSingle(),
  ]);
  const steps: { done: boolean; title: string; detail: string; href: string; optional?: boolean }[] = [
    { done: Boolean(waiver.count), title: "Publish your waiver", detail: "Athletes sign it before they can book.", href: "/admin/plans" },
    { done: Boolean(plans.count), title: "Add a membership plan", detail: "A membership, class pack or drop-in athletes can hold.", href: "/admin/plans" },
    { done: Boolean(classes.count), title: "Put classes on the schedule", detail: "Add the weekly classes, then generate sessions.", href: "/admin/schedule" },
    { done: Boolean(exercises.count), title: "Fill the exercise library", detail: "Start from the starter library and edit it.", href: "/admin/exercises" },
    { done: Boolean(workouts.count), title: "Publish a workout", detail: "It appears in the app and on the gym display.", href: "/admin/programming" },
    { done: Boolean(screen.data?.display_seen_at), title: "Open the display link on the gym TV", detail: "Copy the link from Displays into the TV’s browser.", href: "/admin/display" },
    { done: Boolean(getStripe()), title: "Connect Stripe", detail: "Needed to take card payments. Until then, staff assign memberships by hand.", href: "/admin/memberships", optional: true },
  ];
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  if (done === required.length) return null;

  return (
    <Card title="Set up your gym" actions={<span className="text-muted">{done} of {required.length} done</span>} className="mb-4">
      <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2" data-testid="setup-checklist">
        {steps.map((step) => (
          <li key={step.title} data-done={step.done}>
            <Link href={step.href} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-fill-soft">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-good text-black" : "shadow-[inset_0_0_0_1.5px_var(--color-faint)]"}`}>
                {step.done ? <Icon name="check" size={13} /> : null}
              </span>
              <span>
                <span className={`block text-sm font-semibold leading-tight ${step.done ? "text-muted line-through" : ""}`}>
                  {step.title}{step.optional ? <span className="ml-2 text-xs font-normal text-muted no-underline">Optional</span> : null}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </span>
                {step.done ? null : <span className="text-[13px] text-muted">{step.detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Group({ title, more, children }: { title: string; more?: { count: number; href: string }; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1 text-sm">{children}</ul>
      {more && more.count > 0 ? <Link href={more.href} className="mt-1 inline-block text-[13px] text-muted hover:underline">+{more.count} more</Link> : null}
    </section>
  );
}

/** What a manager should act on today: money at risk, people drifting away, classes people cannot get into. */
export async function NeedsAttention({ supabase, gym }: Pick<Viewer, "supabase" | "gym">) {
  const today = todayInZone(gym.timezone);
  const now = new Date();
  const [pastDue, thawing, waiting, quiet, rewards] = await Promise.all([
    supabase.from("memberships").select("id, user_id, profiles!memberships_user_id_fkey(full_name, email), membership_plans(name)").eq("status", "past_due").order("updated_at"),
    supabase.from("memberships").select("id, user_id, frozen_until, profiles!memberships_user_id_fkey(full_name, email)").eq("status", "frozen").gte("frozen_until", today).lte("frozen_until", addDays(today, 7)).order("frozen_until"),
    supabase.from("class_session_overview").select("id, title, starts_at, waitlist_count, booked_count, capacity").eq("status", "scheduled").gte("starts_at", now.toISOString()).lt("starts_at", new Date(now.getTime() + 7 * 86_400_000).toISOString()).gt("waitlist_count", 0).order("starts_at"),
    supabase.rpc("quiet_members", { p_gym: gym.id, p_days: QUIET_DAYS }),
    gym.milestone_reward ? supabase.rpc("milestones_due", { p_gym: gym.id }) : Promise.resolve({ data: [] as never[] }),
  ]);
  const waitlists = { data: (waiting.data ?? []).filter((s) => (s.booked_count ?? 0) >= (s.capacity ?? 0)) };
  const name = (p: { full_name: string | null; email: string | null } | null) => p?.full_name || p?.email || "(no name)";
  const groups = [pastDue.data, thawing.data, waitlists.data, quiet.data, rewards.data].filter((g) => g?.length).length;

  return (
    <Card title="Needs attention" className="mt-4">
      {groups ? (
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-5" data-testid="needs-attention">
          {pastDue.data?.length ? (
            <Group title={`Payment failed (${pastDue.data.length})`} more={{ count: pastDue.data.length - SHOWN, href: "/admin/members?show=past_due" }}>
              {pastDue.data.slice(0, SHOWN).map((m) => (
                <li key={m.id}><Link href={`/admin/members/${m.user_id}`} className="font-medium hover:underline">{name(m.profiles)}</Link> <span className="text-muted">{m.membership_plans?.name}</span></li>
              ))}
            </Group>
          ) : null}
          {thawing.data?.length ? (
            <Group title={`Freeze ends this week (${thawing.data.length})`} more={{ count: thawing.data.length - SHOWN, href: "/admin/members?show=frozen" }}>
              {thawing.data.slice(0, SHOWN).map((m) => (
                <li key={m.id}><Link href={`/admin/members/${m.user_id}`} className="font-medium hover:underline">{name(m.profiles)}</Link> <span className="text-muted">back {formatDate(m.frozen_until!, { weekday: "short", month: "short", day: "numeric" })}</span></li>
              ))}
            </Group>
          ) : null}
          {waitlists.data?.length ? (
            <Group title={`Full with a waitlist (${waitlists.data.length})`} more={{ count: waitlists.data.length - SHOWN, href: "/admin/schedule" }}>
              {waitlists.data.slice(0, SHOWN).map((s) => (
                <li key={s.id}><Link href={`/admin/schedule/sessions/${s.id}`} className="font-medium hover:underline">{s.title}</Link> <span className="text-muted">{formatDateTime(s.starts_at, gym.timezone)} · {s.waitlist_count} waiting</span></li>
              ))}
            </Group>
          ) : null}
          {quiet.data?.length ? (
            <Group title={`Not seen in ${QUIET_DAYS} days (${quiet.data.length})`} more={{ count: quiet.data.length - SHOWN, href: "/admin/members?show=active" }}>
              {quiet.data.slice(0, SHOWN).map((m) => (
                <li key={m.user_id}><Link href={`/admin/members/${m.user_id}`} className="font-medium hover:underline">{m.full_name || m.email || "(no name)"}</Link> <span className="text-muted">{m.last_visit ? `last in ${formatDate(m.last_visit.slice(0, 10), { month: "short", day: "numeric" })}` : "never checked in"}</span></li>
              ))}
            </Group>
          ) : null}
          {rewards.data?.length ? (
            <Group title={`Reward earned (${rewards.data.length})`}>
              {rewards.data.slice(0, SHOWN).map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1" data-testid="reward-due">
                  <span><Link href={`/admin/members/${m.user_id}`} className="font-medium hover:underline">{m.full_name || m.email || "(no name)"}</Link> <span className="text-muted">{m.visits} visits</span></span>
                  <ActionButton action={markRewardGiven} fields={{ user_id: m.user_id }} variant="tinted">Given</ActionButton>
                </li>
              ))}
              <li className="text-[13px] text-muted">Owed: {gym.milestone_reward}</li>
            </Group>
          ) : null}
        </div>
      ) : (
        <Empty>Nothing needs attention: no failed payments, waitlists or members gone quiet.</Empty>
      )}
    </Card>
  );
}
