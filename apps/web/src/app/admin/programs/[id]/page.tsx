import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate, todayInZone } from "@/lib/format";
import { enrollAthlete, publishProgramWorkouts, removeProgramWorkout, saveProgram, updateEnrollment } from "../actions";

export const metadata = { title: "Program" };

export default async function ProgramPage({ params }: PageProps<"/admin/programs/[id]">) {
  const { supabase, gym, isAdmin } = await requireStaff();
  const { id } = await params;

  const [{ data: program }, { data: tracks }, { data: placed }, { data: enrollments }, { data: members }] = await Promise.all([
    supabase.from("programs").select("*").eq("id", id).maybeSingle(),
    supabase.from("tracks").select("id, name").eq("active", true).order("position"),
    supabase.from("program_workouts").select("week, day, workout_id, workouts(title, status, workout_items(id))").eq("program_id", id),
    supabase.from("enrollments").select("*, profiles(full_name, email)").eq("program_id", id).order("created_at", { ascending: false }),
    supabase.from("gym_members").select("user_id, profiles(full_name, email)").eq("status", "active"),
  ]);
  if (!program) notFound();

  const today = todayInZone(gym.timezone);
  const cell = (week: number, day: number) => (placed ?? []).find((p) => p.week === week && p.day === day);
  const total = program.duration_weeks * program.days_per_week;
  const drafts = (placed ?? []).filter((p) => p.workouts?.status === "draft").length;

  return (
    <>
      <PageHeader
        title={program.name}
        description={`${program.duration_weeks} weeks · ${program.days_per_week} sessions a week · ${placed?.length ?? 0} of ${total} workouts written`}
        actions={
          <>
            <LinkButton href="/admin/programs">All programs</LinkButton>
            <StatusBadge status={program.status} />
          </>
        }
      />

      <Card
        title="Program calendar"
        actions={drafts ? <ActionButton action={publishProgramWorkouts} fields={{ id }} variant="primary">Publish {drafts} draft workout{drafts === 1 ? "" : "s"}</ActionButton> : <Badge tone="good">All workouts published</Badge>}
      >
        <p className="mb-3 text-xs text-muted">
          Day 1 of week 1 is each athlete&apos;s own start date. Leave a day empty for rest.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-16 text-left font-medium">Week</th>
                {Array.from({ length: 7 }, (_, i) => <th key={i} className="min-w-28 text-left font-medium">Day {i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: program.duration_weeks }, (_, w) => (
                <tr key={w}>
                  <td className="align-top text-xs text-muted">Week {w + 1}</td>
                  {Array.from({ length: 7 }, (_, d) => {
                    const placedWorkout = cell(w + 1, d + 1);
                    return (
                      <td key={d} className="align-top">
                        {placedWorkout ? (
                          <div className="rounded-lg border border-line bg-raised p-2">
                            <Link href={`/admin/programming/workouts/${placedWorkout.workout_id}`} className="block text-xs font-medium leading-tight hover:underline">
                              {placedWorkout.workouts?.title}
                            </Link>
                            <div className="mt-1 flex items-center justify-between gap-1">
                              <span className="text-[11px] text-muted">{placedWorkout.workouts?.workout_items.length ?? 0} items</span>
                              {placedWorkout.workouts?.status === "draft" ? <Badge>Draft</Badge> : null}
                            </div>
                            <div className="mt-1">
                              <ActionButton action={removeProgramWorkout} fields={{ program_id: id, workout_id: placedWorkout.workout_id }} variant="ghost" confirm="Remove this workout from the program?">
                                Remove
                              </ActionButton>
                            </div>
                          </div>
                        ) : (
                          <Link
                            href={`/admin/programming/workouts/new?program=${id}&week=${w + 1}&day=${d + 1}`}
                            className="block rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted hover:border-muted hover:text-ink"
                          >
                            + Add
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Settings">
          <ActionForm action={saveProgram} className="space-y-3">
            <input type="hidden" name="id" value={program.id} />
            <Field label="Name"><Input name="name" defaultValue={program.name} required /></Field>
            <Field label="URL name" hint={`Shown at /programs/${program.slug}`}><Input name="slug" defaultValue={program.slug} required /></Field>
            <Field label="Track">
              <Select name="track_id" defaultValue={program.track_id ?? ""}>
                <option value="">No track</option>
                {(tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="One-line summary"><Input name="summary" defaultValue={program.summary ?? ""} /></Field>
            <Field label="Description"><Textarea name="description" defaultValue={program.description ?? ""} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Weeks"><Input name="duration_weeks" type="number" min={1} max={104} defaultValue={program.duration_weeks} required /></Field>
              <Field label="Days / week"><Input name="days_per_week" type="number" min={1} max={7} defaultValue={program.days_per_week} required /></Field>
              <Field label="Price (USD)"><Input name="price" inputMode="decimal" defaultValue={(program.price_cents / 100).toFixed(2)} required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Workouts unlock" hint="Missed workouts always stay available.">
                <Select name="unlock_mode" defaultValue={program.unlock_mode}>
                  <option value="weekly">Week by week</option>
                  <option value="daily">Day by day</option>
                  <option value="all">All at once</option>
                </Select>
              </Field>
              <Field label="Access after final week (days)"><Input name="grace_days" type="number" min={0} defaultValue={program.grace_days} /></Field>
            </div>
            <Field label="Stripe price ID" hint="Optional. Leave empty to charge the price above without creating a Stripe product first.">
              <Input name="stripe_price_id" defaultValue={program.stripe_price_id ?? ""} placeholder="price_…" />
            </Field>
            <Field label="Status" hint="Published programs appear for sale. Archived programs stay available to athletes already enrolled.">
              <Select name="status" defaultValue={program.status}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Card>

        <Card title={`Enrolled athletes (${enrollments?.length ?? 0})`}>
          {enrollments?.length ? (
            <Table head={["Athlete", "Start", "Access until", "Status", ""]}>
              {enrollments.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link href={`/admin/members/${e.user_id}`} className="hover:underline">{e.profiles?.full_name || e.profiles?.email}</Link>
                    <span className="block text-xs text-muted">{e.source}</span>
                  </Td>
                  <Td>{formatDate(e.start_date, { month: "short", day: "numeric" })}</Td>
                  <Td>{e.expires_at ? formatDate(e.expires_at, { month: "short", day: "numeric" }) : "—"}</Td>
                  <Td><StatusBadge status={e.status === "active" && e.expires_at && e.expires_at < today ? "expired" : e.status} /></Td>
                  <Td>
                    {isAdmin ? (
                      <details>
                        <summary className="cursor-pointer text-xs underline">Edit</summary>
                        <ActionForm action={updateEnrollment} className="mt-2 space-y-2">
                          <input type="hidden" name="id" value={e.id} />
                          <Field label="Start date"><Input type="date" name="start_date" defaultValue={e.start_date} /></Field>
                          <Field label="Access until"><Input type="date" name="expires_at" defaultValue={e.expires_at ?? ""} /></Field>
                          <Field label="Status">
                            <Select name="status" defaultValue={e.status}>
                              {["active", "paused", "completed", "cancelled", "refunded"].map((s) => <option key={s}>{s}</option>)}
                            </Select>
                          </Field>
                          <SubmitButton small>Save</SubmitButton>
                        </ActionForm>
                      </details>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No one is enrolled yet.</Empty>
          )}
          {isAdmin ? (
            <ActionForm action={enrollAthlete} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <input type="hidden" name="program_id" value={id} />
              <Field label="Enrol an athlete (no charge)" className="min-w-48 flex-1">
                <Select name="user_id" defaultValue="" required>
                  <option value="" disabled>Choose…</option>
                  {(members ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || m.profiles?.email}</option>)}
                </Select>
              </Field>
              <Field label="Start date"><Input type="date" name="start_date" defaultValue={today} /></Field>
              <SubmitButton variant="secondary">Enrol</SubmitButton>
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
