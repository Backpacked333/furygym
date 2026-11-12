import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, money, titleCase, todayInZone } from "@/lib/format";
import { addFeedback, grantMembership, refundPayment, setRole, updateMembership } from "../actions";

export const metadata = { title: "Member" };

function describeEntry(e: { load: number | null; load_unit: string; reps: number | null; sets: number | null; time_seconds: number | null; distance_m: number | null; rpe: number | null }) {
  const parts: string[] = [];
  if (e.load != null) parts.push(`${e.load} ${e.load_unit}`);
  if (e.sets != null) parts.push(`${e.sets} sets`);
  if (e.reps != null) parts.push(`${e.reps} reps`);
  if (e.time_seconds != null) parts.push(`${Math.floor(e.time_seconds / 60)}:${String(Math.round(e.time_seconds % 60)).padStart(2, "0")}`);
  if (e.distance_m != null) parts.push(`${e.distance_m} m`);
  if (e.rpe != null) parts.push(`RPE ${e.rpe}`);
  return parts.join(" · ");
}

export default async function MemberPage({ params }: PageProps<"/admin/members/[id]">) {
  const { supabase, gym, isAdmin, user } = await requireStaff();
  const { id } = await params;
  const today = todayInZone(gym.timezone);

  const [{ data: member }, { data: memberships }, { data: enrollments }, { data: bookings }, { data: logs }, { data: signatures }, { data: plans }, payments, { data: records }] = await Promise.all([
    supabase.from("gym_members").select("role, status, joined_at, profiles(*)").eq("user_id", id).maybeSingle(),
    supabase.from("memberships").select("*, membership_plans(name, kind)").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("enrollments").select("*, programs(id, name)").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("bookings").select("id, status, late_cancel, class_sessions(id, title, starts_at)").eq("user_id", id).order("booked_at", { ascending: false }).limit(12),
    supabase
      .from("workout_logs")
      .select("id, performed_on, notes, rpe, workouts(title), workout_log_entries(id, set_index, load, load_unit, reps, sets, time_seconds, distance_m, rpe, is_pr, workout_items(title)), coach_feedback(id, body, created_at)")
      .eq("user_id", id)
      .order("performed_on", { ascending: false })
      .limit(8),
    supabase.from("waiver_signatures").select("signed_name, signed_at, waivers(title, version)").eq("user_id", id),
    supabase.from("membership_plans").select("id, name").eq("active", true).order("position"),
    isAdmin ? supabase.from("payments").select("*").eq("user_id", id).order("paid_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: null }),
    supabase.from("personal_records").select("exercise_name, reps, load, load_unit, performed_on").eq("user_id", id).order("exercise_name"),
  ]);
  if (!member?.profiles) notFound();
  const profile = member.profiles;

  return (
    <>
      <PageHeader
        eyebrow="Athletes"
        title={profile.full_name || profile.email || "Member"}
        description={[profile.email, profile.phone].filter(Boolean).join(" · ")}
        actions={
          <>
            <LinkButton href="/admin/members">All members</LinkButton>
            <Badge tone={member.role === "athlete" ? "neutral" : "accent"}>{titleCase(member.role)}</Badge>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Workouts logged" value={logs?.length ?? 0} tone="accent" hint="Most recent sessions shown below" />
        <Stat
          label={records?.[0] ? `${records[0].exercise_name}${records[0].reps ? ` ${records[0].reps}RM` : ""}` : "Personal records"}
          value={records?.[0] ? `${records[0].load} ${records[0].load_unit}` : "—"}
          hint={records?.length ? `${records.length} ${records.length === 1 ? "record" : "records"} tracked` : "No lifts logged yet"}
        />
        <Stat
          label="Plan"
          value={<span className="text-[26px] leading-8">{memberships?.find((m) => ["active", "past_due", "frozen"].includes(m.status))?.membership_plans?.name ?? "None"}</span>}
          hint={enrollments?.filter((e) => e.status === "active").map((e) => `+ ${e.programs?.name}`).join(" ") || undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Memberships">
          {memberships?.length ? (
            <ul className="space-y-3">
              {memberships.map((m) => (
                <li key={m.id} className="rounded-2xl bg-raised p-3.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{m.membership_plans?.name}</span>
                    <span className="flex items-center gap-2"><Badge>{m.source}</Badge><StatusBadge status={m.status} /></span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Started {formatDateTime(m.started_at, gym.timezone)}
                    {m.current_period_end ? ` · renews ${formatDateTime(m.current_period_end, gym.timezone)}` : ""}
                    {m.ends_at ? ` · ends ${formatDateTime(m.ends_at, gym.timezone)}` : ""}
                    {m.credits_remaining != null ? ` · ${m.credits_remaining} class credits left` : ""}
                    {m.frozen_until ? ` · frozen until ${formatDate(m.frozen_until)}` : ""}
                    {m.cancel_at_period_end ? " · cancels at period end" : ""}
                  </p>
                  {isAdmin && ["active", "past_due", "frozen"].includes(m.status) ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {m.status === "frozen" ? (
                        <ActionButton action={updateMembership} fields={{ id: m.id, op: "unfreeze" }}>Unfreeze</ActionButton>
                      ) : (
                        <ActionForm action={updateMembership} resetOnSuccess={false} className="flex items-end gap-2">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="op" value="freeze" />
                          <Field label="Freeze until"><Input type="date" name="frozen_until" min={addDays(today, 7)} max={addDays(today, 92)} required className="py-1 text-xs" /></Field>
                          <SubmitButton small variant="secondary">Freeze</SubmitButton>
                        </ActionForm>
                      )}
                      {m.stripe_subscription_id && !m.cancel_at_period_end ? (
                        <ActionButton action={updateMembership} fields={{ id: m.id, op: "cancel_at_period_end" }} confirm="Stop this membership at the end of the paid period?">Cancel at period end</ActionButton>
                      ) : null}
                      <ActionButton action={updateMembership} fields={{ id: m.id, op: "cancel_now" }} variant="danger" confirm="Cancel this membership immediately? Access ends now.">Cancel now</ActionButton>
                      {m.credits_remaining != null ? (
                        <ActionForm action={updateMembership} resetOnSuccess={false} className="flex items-end gap-2">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="op" value="set_credits" />
                          <Field label="Credits"><Input type="number" name="credits" min={0} defaultValue={m.credits_remaining} className="w-20 py-1 text-xs" /></Field>
                          <SubmitButton small variant="secondary">Set</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No memberships.</Empty>
          )}
          {isAdmin ? (
            <ActionForm action={grantMembership} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <input type="hidden" name="user_id" value={id} />
              <Field label="Add a membership without payment" className="min-w-44 flex-1">
                <Select name="plan_id" defaultValue="" required>
                  <option value="" disabled>Choose a plan…</option>
                  {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Reason">
                <Select name="source" defaultValue="comp"><option value="comp">Complimentary</option><option value="migrated">Carried over from Wodify</option></Select>
              </Field>
              <SubmitButton variant="secondary">Add</SubmitButton>
            </ActionForm>
          ) : null}
        </Card>

        <div className="space-y-4">
          {isAdmin && id !== user.id ? (
            <Card title="Role">
              <ActionForm action={setRole} resetOnSuccess={false} resetKey={member.role} className="flex items-end gap-3">
                <input type="hidden" name="user_id" value={id} />
                <Field label="Access level" hint="Coaches write programming and run classes. Admins also manage members, money and settings." className="flex-1">
                  <Select name="role" defaultValue={member.role}>
                    <option value="athlete">Athlete</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </Select>
                </Field>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Online programs">
            {enrollments?.length ? (
              <ul className="space-y-2 text-sm">
                {enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/programs/${e.programs?.id}`} className="hover:underline">{e.programs?.name}</Link>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {formatDate(e.start_date, { month: "short", day: "numeric" })} → {e.expires_at ? formatDate(e.expires_at, { month: "short", day: "numeric" }) : "—"}
                      <StatusBadge status={e.status === "active" && e.expires_at && e.expires_at < today ? "expired" : e.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not enrolled in any program. Enrol from the program page.</Empty>
            )}
          </Card>

          <Card title="Waivers">
            {signatures?.length ? (
              <ul className="space-y-1 text-sm">
                {signatures.map((s, i) => (
                  <li key={i}>{s.waivers?.title} (v{s.waivers?.version}) — signed “{s.signed_name}” on {formatDateTime(s.signed_at, gym.timezone)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-warn">No waiver signed. This athlete cannot book classes until they sign in the app.</p>
            )}
          </Card>
        </div>

        <Card title="Recent training">
          {logs?.length ? (
            <ul className="space-y-4">
              {logs.map((log) => (
                <li key={log.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{log.workouts?.title}</span>
                    <span className="text-xs text-muted">{formatDate(log.performed_on)}{log.rpe != null ? ` · RPE ${log.rpe}` : ""}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {log.workout_log_entries.slice().sort((a, b) => a.set_index - b.set_index).map((e) => (
                      <li key={e.id}>{e.workout_items?.title}: {describeEntry(e)}{e.is_pr ? <span className="ml-1 font-semibold text-accent">PR</span> : null}</li>
                    ))}
                  </ul>
                  {log.notes ? <p className="mt-1 text-xs italic text-muted">“{log.notes}”</p> : null}
                  {log.coach_feedback.map((f) => (
                    <p key={f.id} className="mt-1 rounded-xl bg-raised px-3 py-1.5 text-xs">Coach: {f.body}</p>
                  ))}
                  <ActionForm action={addFeedback} className="mt-2 flex gap-2">
                    <input type="hidden" name="log_id" value={log.id} />
                    <input type="hidden" name="user_id" value={id} />
                    <Input name="body" placeholder="Send feedback on this session…" className="py-1 text-xs" />
                    <SubmitButton small variant="secondary">Send</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No workouts logged yet.</Empty>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Personal records">
            {records?.length ? (
              <Table head={["Exercise", "Reps", "Best", "Date"]}>
                {records.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.exercise_name}</Td>
                    <Td className="tabular-nums">{r.reps ?? "—"}</Td>
                    <Td className="tabular-nums">{r.load} {r.load_unit}</Td>
                    <Td className="text-muted">{r.performed_on ? formatDate(r.performed_on) : ""}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No records yet.</Empty>
            )}
          </Card>

          <Card title="Recent classes">
            {bookings?.length ? (
              <ul className="space-y-1 text-sm">
                {bookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/schedule/sessions/${b.class_sessions?.id}`} className="hover:underline">
                      {b.class_sessions?.title} <span className="text-xs text-muted">{formatDateTime(b.class_sessions?.starts_at, gym.timezone)}</span>
                    </Link>
                    <span className="flex items-center gap-1">{b.late_cancel ? <Badge tone="warn">late cancel</Badge> : null}<StatusBadge status={b.status} /></span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No bookings yet.</Empty>
            )}
          </Card>
        </div>

        {isAdmin ? (
          <Card title="Payments" className="xl:col-span-2">
            {payments.data?.length ? (
              <Table head={["Date", "For", "Charged", "Fee", "Refunded", "Status", ""]}>
                {payments.data.map((p) => (
                  <tr key={p.id}>
                    <Td className="text-muted">{formatDateTime(p.paid_at ?? p.created_at, gym.timezone)}</Td>
                    <Td>{p.description}</Td>
                    <Td className="tabular-nums">{money(p.amount_cents, p.currency)}</Td>
                    <Td className="tabular-nums text-muted">{money(p.fee_cents, p.currency)}</Td>
                    <Td className="tabular-nums text-muted">{p.refunded_cents ? money(p.refunded_cents, p.currency) : "—"}</Td>
                    <Td><StatusBadge status={p.status} />{p.failure_reason ? <span className="ml-1 text-xs text-muted">{p.failure_reason}</span> : null}</Td>
                    <Td className="text-right">
                      {p.status === "succeeded" && p.stripe_payment_intent_id ? (
                        <ActionButton action={refundPayment} fields={{ id: p.id }} variant="danger" confirm={`Refund ${money(p.amount_cents, p.currency)} to the customer?`}>Refund</ActionButton>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No payments recorded.</Empty>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
