import Link from "next/link";
import { Badge, Card, Empty, Input, PageHeader, StatusBadge, Table, Td, buttonClass } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";

export const metadata = { title: "Members" };

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const { supabase, gym } = await requireStaff();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";

  const [{ data: members }, { data: memberships }, { data: enrollments }] = await Promise.all([
    supabase.from("gym_members").select("user_id, role, status, joined_at, profiles(full_name, email, phone)").order("joined_at", { ascending: false }),
    supabase.from("memberships").select("user_id, status, credits_remaining, membership_plans(name)").in("status", ["active", "past_due", "frozen"]),
    supabase.from("enrollments").select("user_id, programs(name)").eq("status", "active"),
  ]);

  const rows = (members ?? []).filter((m) => {
    if (!q) return true;
    return `${m.profiles?.full_name ?? ""} ${m.profiles?.email ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader eyebrow="Coaching" title="Members" description={`${members?.length ?? 0} ${members?.length === 1 ? "person" : "people"} at ${gym.name}, athletes and staff.`} />
      <form className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by name or email" />
        <button className={buttonClass("secondary")}>Search</button>
      </form>
      <Card>
        {rows.length ? (
          <Table head={["Name", "Role", "Membership", "Programs", "Joined"]}>
            {rows.map((m) => {
              const mine = (memberships ?? []).filter((x) => x.user_id === m.user_id);
              const programs = (enrollments ?? []).filter((x) => x.user_id === m.user_id);
              return (
                <tr key={m.user_id}>
                  <Td>
                    <Link href={`/admin/members/${m.user_id}`} className="font-medium hover:underline">{m.profiles?.full_name || "(no name)"}</Link>
                    <span className="block text-xs text-muted">{m.profiles?.email}</span>
                  </Td>
                  <Td>{m.role === "athlete" ? <span className="text-muted">Athlete</span> : <Badge tone="accent">{titleCase(m.role)}</Badge>}</Td>
                  <Td>
                    {mine.length ? mine.map((x, i) => (
                      <span key={i} className="mr-2 inline-flex items-center gap-1.5">
                        {x.membership_plans?.name}
                        {x.credits_remaining != null ? <span className="text-xs text-muted">({x.credits_remaining} left)</span> : null}
                        {x.status !== "active" ? <StatusBadge status={x.status} /> : null}
                      </span>
                    )) : <span className="text-muted">None</span>}
                  </Td>
                  <Td className="text-muted">{programs.map((p) => p.programs?.name).join(", ") || "—"}</Td>
                  <Td className="text-muted">{formatDateTime(m.joined_at, gym.timezone).split(",").slice(0, 2).join(",")}</Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty>No members match that search.</Empty>
        )}
      </Card>
    </>
  );
}
