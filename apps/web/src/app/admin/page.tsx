import Link from "next/link";
import { Icon } from "@/components/icons";
import { Avatar, Badge, CapacityBar, Card, Empty, LinkButton, PageHeader, Stat, Table, Td, TrackBar, TrackChip } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, formatTime, todayInZone, zonedToUtc } from "@/lib/format";
import { publishState } from "@/lib/workouts";

export const metadata = { title: "Dashboard" };

function summarise(e: { load: number | null; load_unit: string; reps: number | null; time_seconds: number | null; distance_m: number | null }) {
  if (e.load != null) return `${e.load} ${e.load_unit}${e.reps != null ? ` × ${e.reps}` : ""}`;
  if (e.time_seconds != null) return `${Math.floor(e.time_seconds / 60)}:${String(Math.round(e.time_seconds % 60)).padStart(2, "0")}`;
  if (e.distance_m != null) return `${e.distance_m} m`;
  if (e.reps != null) return `${e.reps} reps`;
  return "";
}

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const { supabase, gym, profile } = await requireStaff();
  const { denied } = await searchParams;
  const today = todayInZone(gym.timezone);
  const dayStart = zonedToUtc(today, "00:00", gym.timezone).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), "00:00", gym.timezone).toISOString();
  const now = new Date();

  const [sessions, logs, enrollments, queue] = await Promise.all([
    supabase.from("class_session_overview").select("*").gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    supabase
      .from("workout_logs")
      .select("id, user_id, performed_on, notes, created_at, profiles(full_name), workouts(title), workout_log_entries(load, load_unit, reps, time_seconds, distance_m, is_pr, set_index, workout_items(title)), coach_feedback(id)")
      .gte("performed_on", addDays(today, -7))
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("enrollments").select("id, start_date, program_id, programs(program_workouts(week, day)), workout_logs(id)").eq("status", "active").gte("expires_at", today),
    supabase
      .from("workouts")
      .select("id, title, status, publish_at, scheduled_date, tracks(name, color), workout_items(metrics)")
      .eq("is_template", false)
      .gte("scheduled_date", today)
      .lte("scheduled_date", addDays(today, 3))
      .order("scheduled_date"),
  ]);

  const classes = sessions.data ?? [];
  const booked = classes.reduce((n, s) => n + (s.booked_count ?? 0), 0);
  const checkedIn = classes.reduce((n, s) => n + (s.checked_in_count ?? 0), 0);
  const toReview = (logs.data ?? []).filter((l) => l.coach_feedback.length === 0);
  const newPRs = toReview.filter((l) => l.workout_log_entries.some((e) => e.is_pr)).length;

  // An online athlete is "behind" when three or more of their due sessions are not logged.
  const behind = (enrollments.data ?? []).filter((e) => {
    const start = new Date(`${e.start_date}T00:00:00Z`).getTime();
    const due = (e.programs?.program_workouts ?? []).filter((pw) => start + ((pw.week - 1) * 7 + (pw.day - 1)) * 86_400_000 < new Date(`${today}T00:00:00Z`).getTime()).length;
    return due - e.workout_logs.length >= 3;
  }).length;

  const scheduled = (queue.data ?? []).filter((w) => publishState(w, now) === "scheduled").sort((a, b) => (a.publish_at ?? "").localeCompare(b.publish_at ?? ""));
  const next = scheduled[0];
  const firstName = profile?.full_name?.split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: gym.timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        eyebrow={formatDate(today, { weekday: "long", month: "short", day: "numeric" })}
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        actions={<LinkButton href={`/admin/programming/workouts/new?date=${today}`} variant="primary"><Icon name="plus" size={18} />New workout</LinkButton>}
      />
      {denied ? <p className="mb-4 rounded-2xl bg-warn/15 px-4 py-3 text-sm text-warn">That area is limited to admins and owners.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Checked in today" value={checkedIn} hint={`${booked} booked across ${classes.length} ${classes.length === 1 ? "class" : "classes"}`} />
        <Stat label="Logs to review" value={toReview.length} tone={toReview.length ? "accent" : undefined} hint={newPRs ? `${newPRs} with new PRs` : "Last 7 days"} />
        <Stat label="Online athletes behind" value={behind} hint="Missed 3+ sessions" />
        <Stat
          label="Next publish"
          value={next?.publish_at ? formatTime(next.publish_at, gym.timezone) : "—"}
          hint={next ? `${next.tracks?.name ?? ""} · ${next.title}` : "Nothing scheduled"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_1fr_0.9fr]">
        <Card title="Today’s classes" actions={<LinkButton small href="/admin/schedule">Schedule</LinkButton>}>
          {classes.length ? (
            <Table head={["Time", "Class", "Booked", <span key="in" className="block text-right">In</span>]}>
              {classes.map((s) => (
                <tr key={s.id} className={s.status === "cancelled" ? "opacity-40" : undefined}>
                  <Td className="w-20 font-semibold tabular-nums">{formatTime(s.starts_at!, gym.timezone).replace(/ [AP]M/, "")}</Td>
                  <Td>
                    <Link href={`/admin/schedule/sessions/${s.id}`} className="flex items-stretch gap-3 hover:opacity-80">
                      <TrackBar color={s.track_color} />
                      <span><span className="block font-semibold leading-tight">{s.title}</span><span className="text-[13px] text-muted">{s.coach_name ?? "No coach"}</span></span>
                    </Link>
                  </Td>
                  <Td><CapacityBar booked={s.booked_count ?? 0} capacity={s.capacity ?? 0} /></Td>
                  <Td className="text-right tabular-nums">{s.checked_in_count ? <span className="text-good">{s.checked_in_count}</span> : <span className="text-faint">—</span>}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No classes scheduled today.</Empty>
          )}
        </Card>

        <Card title="Needs review" actions={<span className="text-muted">{toReview.length} {toReview.length === 1 ? "log" : "logs"}</span>}>
          {toReview.length ? (
            <ul className="space-y-3">
              {toReview.slice(0, 5).map((log) => {
                const top = log.workout_log_entries.slice().sort((a, b) => Number(b.is_pr) - Number(a.is_pr) || a.set_index - b.set_index)[0];
                return (
                  <li key={log.id} className="flex items-start gap-3 rounded-2xl bg-raised p-3.5">
                    <Avatar name={log.profiles?.full_name} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold leading-tight">
                        {log.profiles?.full_name}
                        {log.workout_log_entries.some((e) => e.is_pr) ? <Badge tone="gold"><Icon name="trophy" size={12} />PR</Badge> : null}
                      </p>
                      <p className="text-[13px] text-muted">{top ? `${top.workout_items?.title ?? log.workouts?.title} ${summarise(top)}` : log.workouts?.title}</p>
                      {log.notes ? <p className="mt-0.5 text-[13px]">“{log.notes}”</p> : null}
                    </div>
                    <LinkButton small variant="tinted" href={`/admin/members/${log.user_id}`}>Reply</LinkButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Every recent log has feedback.</Empty>
          )}
        </Card>

        <Card title="Publish queue">
          {queue.data?.length ? (
            <ul className="divide-y divide-line">
              {queue.data.slice(0, 6).map((w) => {
                const state = publishState(w, now);
                const missing = state !== "live" && w.workout_items.every((i) => i.metrics.length === 0);
                return (
                  <li key={w.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <TrackChip name={w.tracks?.name} color={w.tracks?.color} />
                      <Badge tone={state === "live" ? "good" : state === "scheduled" ? "accent" : "neutral"}>{state === "live" ? "Published" : state === "scheduled" ? "Scheduled" : "Draft"}</Badge>
                    </div>
                    <Link href={`/admin/programming/workouts/${w.id}`} className="mt-1.5 block font-semibold hover:underline">
                      {w.scheduled_date ? formatDate(w.scheduled_date, { weekday: "short" }) : ""} · {w.title}
                    </Link>
                    <p className={missing ? "text-[13px] text-warn" : "text-[13px] text-muted"}>
                      {missing ? "Missing logging fields" : state === "scheduled" ? `Publishes ${formatDateTime(w.publish_at, gym.timezone)}` : state === "live" ? `Published ${formatDateTime(w.publish_at, gym.timezone)}` : "Not scheduled yet"}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Nothing programmed for the next few days.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
