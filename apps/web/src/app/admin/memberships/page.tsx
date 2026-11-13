import Link from "next/link";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Card, Empty, LinkButton, PageHeader, Segmented, Stat, Table, Td, type Tone } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, money, todayInZone } from "@/lib/format";
import { getStripe } from "@/lib/stripe/client";
import { updateMembership } from "../members/actions";

export const metadata = { title: "Memberships" };

const FILTERS = ["All", "Active", "Past due", "Frozen", "Intro"] as const;

export default async function MembershipsPage({ searchParams }: PageProps<"/admin/memberships">) {
  const { supabase, gym } = await requireAdmin();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.toLowerCase().replace(" ", "-") === params.show) ?? "All";
  const today = todayInZone(gym.timezone);

  const [{ data: memberships }, overview, { data: failed }] = await Promise.all([
    supabase
      .from("memberships")
      .select("*, profiles(full_name, email), membership_plans(name, kind, price_cents, currency)")
      .in("status", ["active", "past_due", "frozen"])
      .order("started_at", { ascending: false }),
    supabase.rpc("report_overview", { p_gym: gym.id, p_from: addDays(today, -29), p_to: today }),
    supabase.from("payments").select("id, user_id, description, amount_cents, currency, failure_reason, created_at, membership_id, profiles(full_name)").eq("status", "failed").order("created_at", { ascending: false }).limit(8),
  ]);
  const stats = (overview.data ?? {}) as Record<string, number | null>;
  const all = (memberships ?? []).filter((m) => !m.ends_at || new Date(m.ends_at) > new Date() || m.status !== "active");
  const intro = all.filter((m) => m.membership_plans?.kind === "intro");
  const pastDue = all.filter((m) => m.status === "past_due");
  const atRisk = pastDue.reduce((n, m) => n + (m.membership_plans?.price_cents ?? 0), 0);

  const rows = all.filter((m) => {
    if (filter === "Active") return m.status === "active" && m.membership_plans?.kind !== "intro";
    if (filter === "Past due") return m.status === "past_due";
    if (filter === "Frozen") return m.status === "frozen";
    if (filter === "Intro") return m.membership_plans?.kind === "intro";
    return true;
  });

  const describe = (m: (typeof all)[number]): { label: string; tone: Tone; next: string; amount: string } => {
    const price = m.membership_plans ? money(m.membership_plans.price_cents, m.membership_plans.currency) : "—";
    if (m.status === "past_due") return { label: "Past due", tone: "warn", next: "Stripe is retrying", amount: price };
    if (m.status === "frozen") return { label: "Frozen", tone: "indigo", next: m.frozen_until ? `Resumes ${formatDate(m.frozen_until, { month: "short", day: "numeric" })}` : "Until resumed", amount: "—" };
    if (m.cancel_at_period_end) return { label: "Canceling", tone: "neutral", next: m.ends_at ? `Ends ${formatDateTime(m.ends_at, gym.timezone).split(",")[0]}` : "Ends at period end", amount: "—" };
    if (m.membership_plans?.kind === "intro") return { label: "Intro", tone: "indigo", next: m.ends_at ? `Ends ${formatDateTime(m.ends_at, gym.timezone).split(",")[0]}` : "", amount: price };
    if (m.credits_remaining != null) return { label: "Active", tone: "good", next: `${m.credits_remaining} ${m.credits_remaining === 1 ? "credit" : "credits"}`, amount: "—" };
    return { label: "Active", tone: "good", next: m.current_period_end ? formatDateTime(m.current_period_end, gym.timezone).split(",")[0] : m.source === "stripe" ? "" : "No billing", amount: m.source === "stripe" ? price : "—" };
  };

  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Memberships"
        actions={
          <>
            <LinkButton href={`/admin/reports/export?type=members&from=${addDays(today, -365)}&to=${today}`}><Icon name="download" size={18} />Export</LinkButton>
            <LinkButton href="/admin/plans">Plans & settings</LinkButton>
            <LinkButton href="/admin/members" variant="primary"><Icon name="plus" size={18} />Add to a member</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Active members" value={stats.active_members ?? 0} hint={`+${stats.new_memberships ?? 0} in 30 days`} />
        <Stat label="On intro offer" value={intro.length} hint="Convert or lapse when it ends" />
        <Stat label="Frozen" value={stats.frozen_members ?? 0} />
        <Stat label="Past due" value={pastDue.length} tone={pastDue.length ? "warn" : undefined} hint={pastDue.length ? `${money(atRisk)} at risk` : "All paid up"} />
        <Stat label="30-day churn" value={stats.churn_rate != null ? `${(Number(stats.churn_rate) * 100).toFixed(1)}%` : "—"} hint={`${stats.recurring_churned ?? 0} of ${stats.recurring_at_period_start ?? 0} recurring`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Card title="All members" actions={<Segmented active={filter} options={FILTERS.map((f) => ({ label: f, href: f === "All" ? "/admin/memberships" : `/admin/memberships?show=${f.toLowerCase().replace(" ", "-")}` }))} />}>
          {rows.length ? (
            <Table head={["Member", "Plan", "Status", "Next", <span key="a" className="block text-right">Amount</span>]}>
              {rows.map((m) => {
                const d = describe(m);
                return (
                  <tr key={m.id}>
                    <Td>
                      <Link href={`/admin/members/${m.user_id}`} className="flex items-center gap-3 hover:opacity-80">
                        <Avatar name={m.profiles?.full_name} size={30} />
                        <span className="font-semibold">{m.profiles?.full_name || m.profiles?.email}</span>
                      </Link>
                    </Td>
                    <Td className="text-muted">{m.membership_plans?.name}</Td>
                    <Td><Badge tone={d.tone}>{d.label}</Badge></Td>
                    <Td className="text-muted">{d.next}</Td>
                    <Td className="text-right tabular-nums">{d.amount}</Td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty>No memberships match this filter.</Empty>
          )}
        </Card>

        <Card title="Failed-payment recovery" actions={failed?.length ? <Badge tone="warn">{failed.length}</Badge> : null}>
          {failed?.length ? (
            <ul className="space-y-3">
              {failed.map((p) => (
                <li key={p.id} className="rounded-2xl bg-raised p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    {p.user_id ? <Link href={`/admin/members/${p.user_id}`} className="font-semibold hover:underline">{p.profiles?.full_name ?? "Member"}</Link> : <span className="font-semibold">Deleted account</span>}
                    <span className="font-semibold tabular-nums text-warn">{money(p.amount_cents, p.currency)}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{p.failure_reason ?? "Payment failed"} · {formatDateTime(p.created_at, gym.timezone)}</p>
                  {p.membership_id ? (
                    <div className="mt-2.5">
                      <ActionButton action={updateMembership} fields={{ id: p.membership_id, op: "cancel_now" }} variant="danger" confirm="Cancel this membership now? Access ends immediately.">Cancel membership</ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No failed payments.</Empty>
          )}
          <p className="mt-4 text-[13px] text-muted">
            {getStripe()
              ? "Stripe retries failed card payments automatically and emails the member a link to update their card. Members keep booking access while it retries."
              : "Stripe is not connected, so no card payments are being taken. Failed payments will be listed here once it is."}
          </p>
        </Card>
      </div>
    </>
  );
}
