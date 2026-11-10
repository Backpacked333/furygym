import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Card, Empty, LinkButton, PageHeader, TrackChip } from "@/components/ui";
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
        eyebrow="Programming"
        title={`Week of ${formatDate(monday, { month: "short", day: "numeric" })}`}
        actions={
          <>
            <LinkButton href={`/admin/programming?week=${addDays(monday, -7)}`} aria-label="Previous week"><Icon name="chevronLeft" size={18} /></LinkButton>
            <LinkButton href="/admin/programming">This week</LinkButton>
            <LinkButton href={`/admin/programming?week=${addDays(monday, 7)}`} aria-label="Next week"><Icon name="chevronRight" size={18} /></LinkButton>
            <LinkButton href={`/admin/programming/workouts/new?date=${today}`} variant="primary"><Icon name="plus" size={18} />New workout</LinkButton>
          </>
        }
      />

      {/* Track rows × day columns. Each cell is a workout card or an empty slot. */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1040px] grid-cols-[120px_repeat(7,minmax(0,1fr))] gap-3">
          <div />
          {days.map((day) => (
            <div key={day} className={`px-1 text-[13px] font-semibold ${day === today ? "text-accent" : "text-muted"}`}>
              {formatDate(day, { weekday: "short", day: "numeric" })}
            </div>
          ))}
          {facilityTracks.map((track) => (
            <div key={track.id} className="contents">
              <div className="pt-2"><TrackChip name={track.name} color={track.color} /></div>
              {days.map((day) => {
                const list = (workouts ?? []).filter((w) => w.scheduled_date === day && w.track_id === track.id);
                return (
                  <div key={day} className="flex min-h-28 flex-col gap-2">
                    {list.map((w) => {
                      const state = publishState(w);
                      return (
                        <Link
                          key={w.id}
                          href={`/admin/programming/workouts/${w.id}`}
                          className={`flex flex-1 flex-col gap-2 rounded-2xl bg-surface p-3 hover:bg-raised ${state === "scheduled" ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : ""}`}
                        >
                          <Badge tone={state === "live" ? "good" : state === "scheduled" ? "accent" : "neutral"}>
                            {state === "live" ? <Icon name="check" size={12} /> : state === "scheduled" ? <Icon name="clock" size={12} /> : null}
                            {state === "live" ? "Published" : state === "scheduled" ? "Scheduled" : "Draft"}
                          </Badge>
                          <span className="text-sm font-semibold leading-tight">{w.title}</span>
                          <span className="mt-auto text-xs text-muted">
                            {state === "scheduled" ? `Publishes ${formatDateTime(w.publish_at, gym.timezone)}` : `${w.workout_items.length} ${w.workout_items.length === 1 ? "block" : "blocks"}`}
                          </span>
                        </Link>
                      );
                    })}
                    <Link
                      href={`/admin/programming/workouts/new?date=${day}&track=${track.id}`}
                      aria-label={`Add ${track.name} workout for ${formatDate(day)}`}
                      className={`flex items-center justify-center rounded-2xl text-faint shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink ${list.length ? "h-8" : "flex-1"}`}
                    >
                      <Icon name="plus" size={16} />
                      <span className="sr-only">+ Add</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Card title="Templates" className="mt-6" actions={<LinkButton small href="/admin/programming/workouts/new?template=1">New template</LinkButton>}>
        {templates?.length ? (
          <ul className="divide-y divide-line">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <span className="inline-flex items-center gap-3"><TrackChip name={t.tracks?.name} color={t.tracks?.color} /><span className="font-semibold">{t.title}</span></span>
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
