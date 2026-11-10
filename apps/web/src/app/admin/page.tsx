import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Stat, Table, Td, TrackDot } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, formatDate, formatTime, todayInZone, zonedToUtc } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const { supabase, gym, isAdmin } = await requireStaff();
  const { denied } = await searchParams;
  const today = todayInZone(gym.timezone);
  const dayStart = zonedToUtc(today, "00:00", gym.timezone).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), "00:00", gym.timezone).toISOString();

  const [sessions, workouts, activeMembers, pastDue, logsToday] = await Promise.all([
    supabase.from("class_session_overview").select("*").gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    supabase.from("workouts").select("id, title, status, publish_at, tracks(name, color)").eq("scheduled_date", today).eq("is_template", false),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).in("status", ["active", "past_due"]),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("status", "past_due"),
    supabase.from("workout_logs").select("id", { count: "exact", head: true }).eq("performed_on", today),
  ]);
  const booked = (sessions.data ?? []).reduce((n, s) => n + (s.booked_count ?? 0), 0);

  return (
    <>
      <PageHeader title="Dashboard" description={formatDate(today, { weekday: "long", month: "long", day: "numeric" })} />
      {denied ? (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">That area is limited to admins and owners.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Classes today" value={sessions.data?.length ?? 0} hint={`${booked} booked`} />
        <Stat label="Active memberships" value={activeMembers.count ?? 0} />
        <Stat label="Past-due memberships" value={pastDue.count ?? 0} hint={isAdmin ? <Link href="/admin/reports" className="underline">See failed payments</Link> : undefined} />
        <Stat label="Workouts logged today" value={logsToday.count ?? 0} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Today's classes" actions={<Link href="/admin/schedule" className="text-xs text-muted underline">Schedule</Link>}>
          {sessions.data?.length ? (
            <Table head={["Time", "Class", "Coach", "Booked", ""]}>
              {sessions.data.map((s) => (
                <tr key={s.id}>
                  <Td className="tabular-nums">{formatTime(s.starts_at!, gym.timezone)}</Td>
                  <Td><span className="inline-flex items-center gap-2"><TrackDot color={s.track_color} />{s.title}</span></Td>
                  <Td className="text-muted">{s.coach_name ?? "—"}</Td>
                  <Td className="tabular-nums">
                    {s.booked_count}/{s.capacity}
                    {s.waitlist_count ? <span className="text-warn"> +{s.waitlist_count} waiting</span> : null}
                  </Td>
                  <Td className="text-right"><Link href={`/admin/schedule/sessions/${s.id}`} className="underline">Roster</Link></Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No classes scheduled today.</Empty>
          )}
        </Card>

        <Card title="Today's programming" actions={<Link href="/admin/programming" className="text-xs text-muted underline">Programming</Link>}>
          {workouts.data?.length ? (
            <ul className="space-y-2">
              {workouts.data.map((w) => {
                const live = w.status === "published" && w.publish_at && new Date(w.publish_at) <= new Date();
                return (
                  <li key={w.id} className="flex items-center justify-between gap-3">
                    <Link href={`/admin/programming/workouts/${w.id}`} className="inline-flex items-center gap-2 hover:underline">
                      <TrackDot color={w.tracks?.color} />
                      <span>{w.title}</span>
                      <span className="text-xs text-muted">{w.tracks?.name}</span>
                    </Link>
                    <Badge tone={live ? "good" : w.status === "published" ? "warn" : "neutral"}>{live ? "Live" : w.status === "published" ? "Scheduled" : "Draft"}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Nothing programmed for today.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
