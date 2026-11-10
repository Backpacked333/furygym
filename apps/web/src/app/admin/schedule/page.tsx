import Link from "next/link";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, TrackDot } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { WEEKDAYS, addDays, dateInZone, formatDate, formatTime, todayInZone, zonedToUtc } from "@/lib/format";
import { addSession, deleteSchedule, generateSessions, saveSchedule } from "./actions";

export const metadata = { title: "Class schedule" };

export default async function SchedulePage() {
  const { supabase, gym, isAdmin } = await requireStaff();
  const today = todayInZone(gym.timezone);
  const from = zonedToUtc(today, "00:00", gym.timezone).toISOString();
  const to = zonedToUtc(addDays(today, 14), "00:00", gym.timezone).toISOString();

  const [{ data: sessions }, { data: schedules }, { data: tracks }, { data: staff }] = await Promise.all([
    supabase.from("class_session_overview").select("*").gte("starts_at", from).lt("starts_at", to).order("starts_at"),
    supabase.from("class_schedules").select("*, tracks(name, color)").order("weekday").order("start_time"),
    supabase.from("tracks").select("id, name").eq("active", true).order("position"),
    supabase.from("staff_directory").select("user_id, full_name"),
  ]);

  const byDay = new Map<string, NonNullable<typeof sessions>>();
  for (const s of sessions ?? []) {
    const day = dateInZone(new Date(s.starts_at!), gym.timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const trackOptions = (tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>);
  const coachOptions = (staff ?? []).map((c) => <option key={c.user_id} value={c.user_id!}>{c.full_name}</option>);

  return (
    <>
      <PageHeader title="Class schedule" description={`Next 14 days. Athletes can book up to ${gym.booking_window_days} days ahead and cancel without penalty until ${gym.cancel_cutoff_minutes} minutes before class.`} />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          {byDay.size === 0 ? <Empty>No upcoming classes. Generate sessions from the weekly schedule.</Empty> : null}
          {[...byDay.entries()].map(([day, list]) => (
            <Card key={day} title={<>{formatDate(day, { weekday: "long", month: "short", day: "numeric" })}{day === today ? <span className="ml-2 text-accent">Today</span> : null}</>}>
              <Table head={["Time", "Class", "Coach", "Booked", ""]}>
                {list.map((s) => (
                  <tr key={s.id} className={s.status === "cancelled" ? "opacity-50" : ""}>
                    <Td className="w-24 tabular-nums">{formatTime(s.starts_at!, gym.timezone)}</Td>
                    <Td><span className="inline-flex items-center gap-2"><TrackDot color={s.track_color} />{s.title}</span></Td>
                    <Td className="text-muted">{s.coach_name ?? "—"}</Td>
                    <Td className="tabular-nums">
                      {s.status === "cancelled" ? <Badge tone="bad">Cancelled</Badge> : <>{s.booked_count}/{s.capacity}{s.waitlist_count ? <span className="text-warn"> +{s.waitlist_count}</span> : null}</>}
                    </Td>
                    <Td className="text-right"><Link href={`/admin/schedule/sessions/${s.id}`} className="underline">Roster</Link></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
        </div>

        {isAdmin ? (
          <div className="space-y-6">
            <Card title="Weekly schedule">
              {schedules?.length ? (
                <ul className="divide-y divide-line text-sm">
                  {schedules.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <span className="inline-flex items-center gap-2"><TrackDot color={s.tracks?.color} />{s.title}</span>
                        <span className="block text-xs text-muted">{WEEKDAYS[s.weekday]} {s.start_time.slice(0, 5)} · {s.duration_minutes} min · {s.capacity} places</span>
                      </span>
                      <ActionButton action={deleteSchedule} fields={{ id: s.id }} variant="ghost" confirm={`Remove ${s.title} on ${WEEKDAYS[s.weekday]} from the weekly schedule?`}>Remove</ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No recurring classes yet.</Empty>
              )}
              <ActionForm action={generateSessions} className="mt-4 flex items-end gap-3 border-t border-line pt-4">
                <Field label="Generate bookable sessions for the next">
                  <Select name="weeks" defaultValue="4">
                    <option value="2">2 weeks</option>
                    <option value="4">4 weeks</option>
                    <option value="8">8 weeks</option>
                    <option value="12">12 weeks</option>
                  </Select>
                </Field>
                <SubmitButton variant="secondary">Generate</SubmitButton>
              </ActionForm>
            </Card>

            <Card title="Add a recurring class">
              <ActionForm action={saveSchedule} className="space-y-3">
                <Field label="Title"><Input name="title" placeholder="Strength 6AM" required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Day">
                    <Select name="weekday" defaultValue="1">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
                  </Field>
                  <Field label="Start time"><Input name="start_time" type="time" required /></Field>
                  <Field label="Minutes"><Input name="duration_minutes" type="number" min={15} defaultValue={60} /></Field>
                  <Field label="Places"><Input name="capacity" type="number" min={1} defaultValue={16} /></Field>
                  <Field label="Track"><Select name="track_id" defaultValue=""><option value="">None</option>{trackOptions}</Select></Field>
                  <Field label="Coach"><Select name="coach_id" defaultValue=""><option value="">Unassigned</option>{coachOptions}</Select></Field>
                </div>
                <SubmitButton variant="secondary">Add to weekly schedule</SubmitButton>
              </ActionForm>
            </Card>

            <Card title="Add a one-off class">
              <ActionForm action={addSession} className="space-y-3">
                <Field label="Title"><Input name="title" placeholder="Saturday Workshop" required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date"><Input name="date" type="date" defaultValue={today} required /></Field>
                  <Field label="Start time"><Input name="start_time" type="time" required /></Field>
                  <Field label="Minutes"><Input name="duration_minutes" type="number" min={15} defaultValue={60} /></Field>
                  <Field label="Places"><Input name="capacity" type="number" min={1} defaultValue={16} /></Field>
                  <Field label="Track"><Select name="track_id" defaultValue=""><option value="">None</option>{trackOptions}</Select></Field>
                  <Field label="Coach"><Select name="coach_id" defaultValue=""><option value="">Unassigned</option>{coachOptions}</Select></Field>
                </div>
                <SubmitButton variant="secondary">Add class</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
