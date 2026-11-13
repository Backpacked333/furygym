import Link from "next/link";
import { Card, Empty, PageHeader, Segmented, Table, Td } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";

export const metadata = { title: "Activity" };

const ENTITIES: Record<string, string> = {
  gym_members: "Role or access",
  memberships: "Membership",
  enrollments: "Program enrolment",
  membership_plans: "Plan",
  programs: "Program",
  display_state: "Gym display",
};
const VERBS: Record<string, string> = { insert: "Added", update: "Changed", delete: "Removed" };
const FILTERS = [
  { label: "All", value: "" },
  { label: "Roles", value: "gym_members" },
  { label: "Memberships", value: "memberships" },
  { label: "Enrolments", value: "enrollments" },
  { label: "Plans", value: "membership_plans" },
];
const HIDDEN = new Set(["updated_at", "created_at"]);
const LIST = 100;

type Row = Record<string, unknown>;
const show = (v: unknown) => (v == null || v === "" ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** What changed, in the columns' own names: "status: active → frozen". */
function summarise(action: string, details: unknown): string {
  const d = (details ?? {}) as { before?: Row; after?: Row } & Row;
  if (action !== "update" || !d.before || !d.after) {
    return ["name", "title", "role", "status", "source"].filter((k) => d[k] != null).map((k) => `${titleCase(k)}: ${show(d[k])}`).join(" · ");
  }
  const { before, after } = d;
  return Object.keys(after)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${titleCase(k)}: ${show(before[k])} → ${show(after[k])}`)
    .join(" · ");
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const { supabase, gym } = await requireAdmin();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.value && f.value === params.show) ?? FILTERS[0];

  let query = supabase.from("audit_log").select("*", { count: "exact" }).eq("gym_id", gym.id);
  if (filter.value) query = query.eq("entity", filter.value);
  const { data: entries, count, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(LIST);

  // The log stores ids. Names are looked up for the people on this page only.
  const subject = (e: { entity: string; entity_id: string | null; details: unknown }) => {
    const d = (e.details ?? {}) as { after?: Row } & Row;
    const userId = (d.after ?? d).user_id;
    return typeof userId === "string" ? userId : null;
  };
  const ids = [...new Set((entries ?? []).flatMap((e) => [e.actor_id, subject(e)]).filter((v): v is string => Boolean(v)))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email || "Member"]));

  return (
    <>
      <PageHeader eyebrow="Business" title="Activity" description="Every change to roles, memberships, enrolments, plans, programs and the gym display, with who made it." />
      <Card
        title="Change log"
        actions={<Segmented active={filter.label} options={FILTERS.map((f) => ({ label: f.label, href: f.value ? `/admin/activity?show=${f.value}` : "/admin/activity" }))} />}
      >
        {error ? (
          <p className="text-sm text-bad">Could not load the change log: {error.message}</p>
        ) : entries?.length ? (
          <Table head={["When", "Who", "What", "For", "Change"]}>
            {entries.map((e) => {
              const who = subject(e);
              return (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(e.created_at, gym.timezone)}</Td>
                  <Td>{e.actor_id ? (names.get(e.actor_id) ?? "Deleted account") : <span className="text-muted">System (billing or schedule)</span>}</Td>
                  <Td className="whitespace-nowrap">{VERBS[e.action] ?? titleCase(e.action)} · {ENTITIES[e.entity] ?? titleCase(e.entity)}</Td>
                  <Td>{who ? <Link href={`/admin/members/${who}`} className="hover:underline">{names.get(who) ?? "Deleted account"}</Link> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-[13px] text-muted">{summarise(e.action, e.details) || "—"}</Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty>No changes recorded yet.</Empty>
        )}
        {count && count > LIST ? <p className="mt-3 text-[13px] text-muted">Showing the newest {LIST} of {count} changes.</p> : null}
      </Card>
    </>
  );
}
