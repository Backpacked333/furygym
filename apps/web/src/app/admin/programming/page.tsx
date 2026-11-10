import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, TrackDot } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, startOfWeek, todayInZone } from "@/lib/format";
import { publishState } from "@/lib/workouts";

export const metadata = { title: "Programming" };

export default async function ProgrammingPage({ searchParams }: PageProps<"/admin/programming">) {
  const { supabase, gym } = await requireStaff();
  const params = await searchParams;
  const today = todayInZone(gym.timezone);
  const anchor = typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : today;
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const [{ data: tracks }, { data: workouts }, { data: templates }] = await Promise.all([
    supabase.from("tracks").select("*").eq("active", true).order("position"),
    supabase
      .from("workouts")
      .select("id, title, status, publish_at, scheduled_date, track_id, workout_items(id)")
      .gte("scheduled_date", days[0])
      .lte("scheduled_date", days[6])
      .eq("is_template", false)
      .order("created_at"),
    supabase.from("workouts").select("id, title, track_id, tracks(name, color)").eq("is_template", true).order("title"),
  ]);
  const facilityTracks = (tracks ?? []).filter((t) => t.kind === "facility");

  return (
    <>
      <PageHeader
        title="Programming"
        description="Build workouts for each track, choose what athletes record, and schedule when they publish to the app and gym display."
        actions={
          <>
            <LinkButton href={`/admin/programming?week=${addDays(monday, -7)}`}>← Previous</LinkButton>
            <LinkButton href="/admin/programming">This week</LinkButton>
            <LinkButton href={`/admin/programming?week=${addDays(monday, 7)}`}>Next →</LinkButton>
          </>
        }
      />
      <p className="mb-3 text-sm text-muted">
        Week of {formatDate(monday, { month: "long", day: "numeric", year: "numeric" })}
      </p>

      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((day) => (
          <section key={day} className={`rounded-xl border bg-surface p-3 ${day === today ? "border-accent/60" : "border-line"}`}>
            <h2 className="mb-2 text-xs font-semibold text-muted">
              {formatDate(day)}
              {day === today ? <span className="ml-1 text-accent">· today</span> : null}
            </h2>
            <div className="space-y-3">
              {facilityTracks.map((track) => {
                const list = (workouts ?? []).filter((w) => w.scheduled_date === day && w.track_id === track.id);
                return (
                  <div key={track.id}>
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-muted"><TrackDot color={track.color} />{track.name}</p>
                    {list.map((w) => {
                      const state = publishState(w);
                      return (
                        <Link key={w.id} href={`/admin/programming/workouts/${w.id}`} className="mb-1 block rounded-lg border border-line bg-raised p-2 hover:border-muted">
                          <span className="block text-sm font-medium leading-tight">{w.title}</span>
                          <span className="mt-1 flex items-center justify-between gap-1 text-xs text-muted">
                            <span>{w.workout_items.length} item{w.workout_items.length === 1 ? "" : "s"}</span>
                            <Badge tone={state === "live" ? "good" : state === "scheduled" ? "warn" : "neutral"}>
                              {state === "live" ? "Live" : state === "scheduled" ? "Scheduled" : "Draft"}
                            </Badge>
                          </span>
                          {state === "scheduled" ? <span className="mt-1 block text-[11px] text-muted">Publishes {formatDateTime(w.publish_at, gym.timezone)}</span> : null}
                        </Link>
                      );
                    })}
                    <Link href={`/admin/programming/workouts/new?date=${day}&track=${track.id}`} className="block rounded-lg border border-dashed border-line px-2 py-1 text-center text-xs text-muted hover:border-muted hover:text-ink">
                      + Add
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Card title="Templates" className="mt-6" actions={<LinkButton small href="/admin/programming/workouts/new?template=1">New template</LinkButton>}>
        {templates?.length ? (
          <ul className="divide-y divide-line">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="inline-flex items-center gap-2 text-sm"><TrackDot color={t.tracks?.color} />{t.title}</span>
                <span className="flex gap-2">
                  <LinkButton small href={`/admin/programming/workouts/new?from=${t.id}&date=${today}`}>Use for a date</LinkButton>
                  <LinkButton small variant="ghost" href={`/admin/programming/workouts/${t.id}`}>Edit</LinkButton>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No templates yet. Save a workout as a template to reuse it.</Empty>
        )}
      </Card>
    </>
  );
}
