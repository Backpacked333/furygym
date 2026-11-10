import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { dateInZone, formatDate, formatTime } from "@/lib/format";
import { setAttendance, staffBook, staffCancelBooking, updateSession } from "../../actions";

export const metadata = { title: "Class roster" };

export default async function SessionPage({ params }: PageProps<"/admin/schedule/sessions/[id]">) {
  const { supabase, gym, isAdmin } = await requireStaff();
  const { id } = await params;

  const [{ data: session }, { data: bookings }, { data: members }, { data: staff }] = await Promise.all([
    supabase.from("class_session_overview").select("*").eq("id", id).maybeSingle(),
    supabase.from("bookings").select("*, profiles!bookings_user_id_fkey(full_name, email)").eq("session_id", id).neq("status", "cancelled").order("booked_at"),
    supabase.from("gym_members").select("user_id, profiles(full_name, email)").eq("status", "active"),
    supabase.from("staff_directory").select("user_id, full_name"),
  ]);
  if (!session) notFound();

  const roster = (bookings ?? []).filter((b) => b.status !== "waitlisted");
  const waitlist = (bookings ?? []).filter((b) => b.status === "waitlisted");
  const bookedIds = new Set((bookings ?? []).map((b) => b.user_id));
  const day = dateInZone(new Date(session.starts_at!), gym.timezone);

  return (
    <>
      <PageHeader
        title={session.title ?? "Class"}
        description={`${formatDate(day, { weekday: "long", month: "long", day: "numeric" })} · ${formatTime(session.starts_at!, gym.timezone)}–${formatTime(session.ends_at!, gym.timezone)} · ${session.coach_name ?? "No coach assigned"}`}
        actions={
          <>
            <LinkButton href="/admin/schedule">Schedule</LinkButton>
            {session.status === "cancelled" ? <Badge tone="bad">Cancelled</Badge> : <Badge tone={session.booked_count! >= session.capacity! ? "warn" : "good"}>{session.booked_count}/{session.capacity} booked</Badge>}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Roster">
            {roster.length ? (
              <Table head={["Athlete", "Status", "Attendance", ""]}>
                {roster.map((b) => (
                  <tr key={b.id} data-testid="roster-row">
                    <Td>
                      <Link href={`/admin/members/${b.user_id}`} className="hover:underline">{b.profiles?.full_name || b.profiles?.email}</Link>
                      {b.credit_used ? <span className="ml-2 text-xs text-muted">class credit</span> : null}
                    </Td>
                    <Td><StatusBadge status={b.status} /></Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {b.status !== "attended" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "attended" }} variant="primary">Check in</ActionButton> : null}
                        {b.status !== "no_show" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "no_show" }}>No-show</ActionButton> : null}
                        {b.status !== "booked" ? <ActionButton action={setAttendance} fields={{ booking_id: b.id, session_id: id, status: "booked" }} variant="ghost">Undo</ActionButton> : null}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <ActionButton action={staffCancelBooking} fields={{ booking_id: b.id, session_id: id }} variant="ghost" confirm="Remove this athlete from the class? Any class credit is returned.">Remove</ActionButton>
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No one is booked yet.</Empty>
            )}
          </Card>

          {waitlist.length ? (
            <Card title={`Waitlist (${waitlist.length})`}>
              <ol className="space-y-2 text-sm">
                {waitlist.map((b, i) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span><span className="mr-2 text-muted">{i + 1}.</span>{b.profiles?.full_name || b.profiles?.email}</span>
                    <ActionButton action={staffCancelBooking} fields={{ booking_id: b.id, session_id: id }} variant="ghost">Remove</ActionButton>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">The first person on the list is moved into the class automatically when a place opens.</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title="Add a member">
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
              <SubmitButton variant="secondary">Add to class</SubmitButton>
            </ActionForm>
          </Card>

          {isAdmin ? (
            <Card title="Class settings">
              <ActionForm action={updateSession} className="space-y-3">
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
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
