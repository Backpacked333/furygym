import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Stat, Table, Td, TrackBar } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, dateInZone, formatDate, formatTime, zonedToUtc } from "@/lib/format";
import { setAttendance, staffBook, staffCancelBooking, updateSession } from "../../actions";

export const metadata = { title: "Class roster" };

export default async function SessionPage({ params }: PageProps<"/admin/schedule/sessions/[id]">) {
  const { supabase, gym, isAdmin } = await requireStaff();
  const { id } = await params;

  const { data: session } = await supabase.from("class_session_overview").select("*").eq("id", id).maybeSingle();
  if (!session) notFound();
  const day = dateInZone(new Date(session.starts_at!), gym.timezone);
  const dayStart = zonedToUtc(day, "00:00", gym.timezone).toISOString();
  const dayEnd = zonedToUtc(addDays(day, 1), "00:00", gym.timezone).toISOString();

  const [{ data: bookings }, { data: members }, { data: staff }, { data: siblings }] = await Promise.all([
    supabase.from("bookings").select("*, profiles!bookings_user_id_fkey(full_name, email)").eq("session_id", id).order("booked_at"),
    supabase.from("gym_members").select("user_id, profiles(full_name, email)").eq("status", "active"),
    supabase.from("staff_directory").select("user_id, full_name"),
    supabase.from("class_session_overview").select("id, title, starts_at, coach_name, track_color, booked_count, capacity").gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
  ]);
  const live = (bookings ?? []).filter((b) => b.status !== "cancelled");
  const roster = live.filter((b) => b.status !== "waitlisted");
  const waitlist = live.filter((b) => b.status === "waitlisted");
  const lateCancels = (bookings ?? []).filter((b) => b.status === "cancelled" && b.late_cancel);
  // Athletes who held a place or a waitlist spot when the gym cancelled the class.
  const toTell = session.status === "cancelled" ? (bookings ?? []).filter((b) => b.class_cancelled) : [];
  const emails = [...new Set(toTell.map((b) => b.profiles?.email).filter((e): e is string => Boolean(e)))];
  const classLabel = `${session.title} on ${formatDate(day, { weekday: "long", month: "short", day: "numeric" })} at ${formatTime(session.starts_at!, gym.timezone)}`;
  const mailto = `mailto:?bcc=${emails.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(`${session.title} is cancelled`)}&body=${encodeURIComponent(`Hi,\n\n${classLabel} has been cancelled. Your place has been released and any class credit you used has been returned.\n\nYou can book another class in the app.\n\n${gym.name}`)}`;
  const bookedIds = new Set(live.map((b) => b.user_id));

  // What each athlete is booked on, and whether this is their first class.
  const ids = [...new Set([...roster, ...lateCancels].map((b) => b.user_id))];
  const [{ data: memberships }, { data: history }] = await Promise.all([
    ids.length ? supabase.from("memberships").select("user_id, status, credits_remaining, membership_plans(name)").in("user_id", ids).in("status", ["active", "past_due"]) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("bookings").select("user_id").in("user_id", ids).eq("status", "attended") : Promise.resolve({ data: [] as never[] }),
  ]);
  const attended = new Set((history ?? []).map((h) => h.user_id));
  const membershipOf = (userId: string) => {
    const m = (memberships ?? []).find((x) => x.user_id === userId);
    if (!m) return "No membership · walk-in";
    return `${m.membership_plans?.name}${m.credits_remaining != null ? ` · ${m.credits_remaining} left` : ""}${m.status === "past_due" ? " · past due" : ""}`;
  };
  const minutes = Math.round((new Date(session.starts_at!).getTime() - new Date().getTime()) / 60_000);

  return (
    <>
      <PageHeader
        eyebrow={<>Classes · {formatDate(day, { weekday: "short", month: "short", day: "numeric" })}</>}
        title={`${session.title} · ${formatTime(session.starts_at!, gym.timezone)}`}
        actions={
          <>
            {session.status === "cancelled" ? <Badge tone="bad">Cancelled</Badge> : null}
            <LinkButton href="/admin/checkin">Scan check-ins</LinkButton>
            <LinkButton href="/admin/schedule">Schedule</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card title={formatDate(day, { weekday: "short", month: "short", day: "numeric" })}>
          <ul className="space-y-1">
            {(siblings ?? []).map((s) => (
              <li key={s.id}>
                <Link href={`/admin/schedule/sessions/${s.id}`} className={`flex items-stretch gap-3 rounded-2xl px-3 py-2.5 ${s.id === id ? "bg-fill" : "hover:bg-fill-soft"}`}>
                  <TrackBar color={s.track_color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold leading-tight">{formatTime(s.starts_at!, gym.timezone).replace(/ [AP]M/, "")} · {s.title}</span>
                    <span className="text-[13px] text-muted">{s.coach_name ?? "No coach"}</span>
                  </span>
                  <span className={`self-center text-[13px] font-semibold tabular-nums ${(s.booked_count ?? 0) >= (s.capacity ?? 0) ? "text-warn" : "text-muted"}`}>{s.booked_count}/{s.capacity}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Booked" value={`${session.booked_count} / ${session.capacity}`} />
            <Stat label="Checked in" value={session.checked_in_count ?? 0} tone="good" hint={minutes > 0 ? `Class starts in ${minutes >= 90 ? `${Math.round(minutes / 60)} hr` : `${minutes} min`}` : minutes > -90 ? "In progress" : "Finished"} />
            <Stat label="Waitlist" value={waitlist.length} />
            <Stat label="Coach" value={<span className="text-[26px] leading-8">{session.coach_name ?? "—"}</span>} />
          </div>

          {toTell.length ? (
            <Card title={`Tell ${toTell.length} ${toTell.length === 1 ? "athlete" : "athletes"} this class is cancelled`} actions={emails.length ? <LinkButton small variant="primary" href={mailto}>Email all</LinkButton> : null}>
              <p className="mb-3 text-[13px] text-muted">The app shows each of them a notice on their Today screen. Nothing is emailed automatically: “Email all” opens your own email with everyone in Bcc.</p>
              <ul className="divide-y divide-line" data-testid="cancelled-athletes">
                {toTell.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/admin/members/${b.user_id}`} className="font-medium hover:underline">{b.profiles?.full_name || "(no name)"}</Link>
                    {b.profiles?.email ? <a href={`mailto:${b.profiles.email}`} className="text-muted hover:underline">{b.profiles.email}</a> : <span className="text-faint">No email</span>}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Roster">
            {roster.length || lateCancels.length ? (
              <Table head={["Athlete", "Membership", "Notes", <span key="s" className="block text-right">Status</span>]}>
                {roster.map((b) => (
                  <tr key={b.id} data-testid="roster-row">
                    <Td>
                      <Link href={`/admin/members/${b.user_id}`} className="flex items-center gap-3 hover:opacity-80">
                        <Avatar name={b.profiles?.full_name} size={30} />
                        <span className="font-semibold">{b.profiles?.full_name || b.profiles?.email}</span>
                      </Link>
                    </Td>
                    <Td className="text-muted">{membershipOf(b.user_id)}{b.credit_used ? <span className="ml-2 text-xs">class credit</span> : null}</Td>
                    <Td>{!attended.has(b.user_id) && b.status !== "attended" ? <Badge tone="indigo">First class</Badge> : null}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {b.status === "attended" ? <Badge tone="good"><span className="sr-only">attended</span>Checked in</Badge> : null}
                        {b.status === "no_show" ? <Badge tone="bad">no show</Badge> : null}
                        {b.status === "booked" ? <span className="sr-only">booked</span> : null}
                        {b.status !== "attended" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "attended" }} variant="tinted">Check in</ActionButton> : null}
                        {b.status === "booked" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "no_show" }} variant="ghost">No-show</ActionButton> : null}
                        {b.status !== "booked" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "booked" }} variant="ghost">Undo</ActionButton> : null}
                        <ActionButton action={staffCancelBooking} fields={{ booking_id: b.id, session_id: id }} variant="ghost" confirm="Remove this athlete from the class? Any class credit is returned.">Remove</ActionButton>
                      </span>
                    </Td>
                  </tr>
                ))}
                {lateCancels.map((b) => (
                  <tr key={b.id} className="opacity-70">
                    <Td><span className="flex items-center gap-3"><Avatar name={b.profiles?.full_name} size={30} /><span className="font-semibold">{b.profiles?.full_name || b.profiles?.email}</span></span></Td>
                    <Td className="text-muted">{membershipOf(b.user_id)}</Td>
                    <Td />
                    <Td className="text-right"><Badge tone="warn">Late cancel</Badge></Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No one is booked yet.</Empty>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Waitlist (${waitlist.length})`}>
              {waitlist.length ? (
                <ol className="space-y-2">
                  {waitlist.map((b, i) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <span><span className="mr-2 text-muted">{i + 1}.</span>{b.profiles?.full_name || b.profiles?.email}</span>
                      <ActionButton action={staffCancelBooking} fields={{ booking_id: b.id, session_id: id }} variant="ghost">Remove</ActionButton>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Nobody is waiting.</p>
              )}
              <p className="mt-3 text-[13px] text-muted">The first person in line is moved into the class automatically when a place opens.</p>
            </Card>

            <Card title="Add walk-in">
              <ActionForm action={staffBook} className="space-y-3">
                <input type="hidden" name="session_id" value={id} />
                <Field label="Member" hint="Staff can add walk-ins who have no membership yet.">
                  <Select name="user_id" defaultValue="" required>
                    <option value="" disabled>Choose…</option>
                    {(members ?? []).filter((m) => !bookedIds.has(m.user_id)).map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || m.profiles?.email}</option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton variant="primary">Add to class</SubmitButton>
              </ActionForm>
            </Card>
          </div>

          {isAdmin ? (
            <Card title="Class settings">
              <ActionForm action={updateSession} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={id} />
                <Field label="Places"><Input name="capacity" type="number" min={1} defaultValue={session.capacity ?? 16} /></Field>
                <Field label="Coach">
                  <Select name="coach_id" defaultValue={session.coach_id ?? ""}>
                    <option value="">Unassigned</option>
                    {(staff ?? []).map((c) => <option key={c.user_id} value={c.user_id!}>{c.full_name}</option>)}
                  </Select>
                </Field>
                <Field label="Note for staff"><Input name="notes" defaultValue={session.notes ?? ""} /></Field>
                <Field label="Status">
                  <Select name="status" defaultValue={session.status ?? "scheduled"}>
                    <option value="scheduled">Scheduled</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </Field>
                <div className="sm:col-span-4"><SubmitButton variant="secondary">Save</SubmitButton></div>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
