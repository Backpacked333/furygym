import Link from "next/link";
import { Badge, Card, Empty, Field, Input, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addDays, formatDate, formatDateTime, money, titleCase, todayInZone } from "@/lib/format";

export const metadata = { title: "Reports" };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { supabase, gym } = await requireAdmin();
  const params = await searchParams;
  const today = todayInZone(gym.timezone);
  const to = isDate(params.to) ? params.to : today;
  const from = isDate(params.from) ? params.from : addDays(to, -29);

  const [revenue, overview, { data: failed }, { data: payouts }] = await Promise.all([
    supabase.rpc("report_revenue", { p_gym: gym.id, p_from: from, p_to: to }),
    supabase.rpc("report_overview", { p_gym: gym.id, p_from: from, p_to: to }),
    supabase.from("payments").select("id, user_id, description, amount_cents, currency, failure_reason, created_at, profiles(full_name, email)").eq("status", "failed").order("created_at", { ascending: false }).limit(20),
    supabase.from("payouts").select("*").order("arrival_date", { ascending: false }).limit(10),
  ]);

  const rows = revenue.data ?? [];
  const stats = (overview.data ?? {}) as Record<string, number | null>;
  const sum = (key: "gross_cents" | "tax_cents" | "fee_cents" | "refunded_cents" | "net_cents" | "payments", stream?: string) =>
    rows.filter((r) => !stream || r.revenue_stream === stream).reduce((n, r) => n + Number(r[key]), 0);
  const streams = [...new Set(rows.map((r) => r.revenue_stream))];
  const exportHref = (type: string) => `/admin/reports/export?type=${type}&from=${from}&to=${to}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${formatDate(from, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(to, { month: "short", day: "numeric", year: "numeric" })}`}
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <Field label="From"><Input type="date" name="from" defaultValue={from} /></Field>
            <Field label="To"><Input type="date" name="to" defaultValue={to} /></Field>
            <button className={buttonClass("secondary")}>Apply</button>
          </form>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross sales" value={money(sum("gross_cents"))} hint="Before tax, fees and refunds" />
        <Stat label="Processing fees" value={money(sum("fee_cents"))} />
        <Stat label="Refunds" value={money(sum("refunded_cents"))} />
        <Stat label="Net to bank" value={money(sum("net_cents"))} hint={`Payouts received: ${money(Number(stats.payouts_cents ?? 0))}`} />
      </div>

      <Card title="Revenue by stream" className="mt-6" actions={<Link href={exportHref("payments")} className="text-xs underline">Export payments (CSV)</Link>}>
        {revenue.error ? (
          <p className="text-sm text-bad">Could not load revenue: {revenue.error.message}</p>
        ) : rows.length ? (
          <Table head={["Stream", "Type", "Payments", "Gross sales", "Tax collected", "Fees", "Refunds", "Net"]}>
            {streams.map((stream) => (
              <RevenueGroup key={stream} label={stream === "facility" ? "Facility" : "Digital programs"}>
                {rows.filter((r) => r.revenue_stream === stream).map((r) => (
                  <tr key={r.kind}>
                    <Td />
                    <Td>{titleCase(r.kind)}</Td>
                    <Td className="tabular-nums">{r.payments}</Td>
                    <Td className="tabular-nums">{money(r.gross_cents)}</Td>
                    <Td className="tabular-nums text-muted">{money(r.tax_cents)}</Td>
                    <Td className="tabular-nums text-muted">{money(r.fee_cents)}</Td>
                    <Td className="tabular-nums text-muted">{money(r.refunded_cents)}</Td>
                    <Td className="tabular-nums">{money(r.net_cents)}</Td>
                  </tr>
                ))}
                <tr className="bg-raised/50 font-medium">
                  <Td>{stream === "facility" ? "Facility" : "Digital programs"}</Td>
                  <Td className="text-muted">Subtotal</Td>
                  <Td className="tabular-nums">{sum("payments", stream)}</Td>
                  <Td className="tabular-nums">{money(sum("gross_cents", stream))}</Td>
                  <Td className="tabular-nums">{money(sum("tax_cents", stream))}</Td>
                  <Td className="tabular-nums">{money(sum("fee_cents", stream))}</Td>
                  <Td className="tabular-nums">{money(sum("refunded_cents", stream))}</Td>
                  <Td className="tabular-nums">{money(sum("net_cents", stream))}</Td>
                </tr>
              </RevenueGroup>
            ))}
            <tr className="font-semibold" data-testid="revenue-total">
              <Td>Total</Td>
              <Td />
              <Td className="tabular-nums">{sum("payments")}</Td>
              <Td className="tabular-nums">{money(sum("gross_cents"))}</Td>
              <Td className="tabular-nums">{money(sum("tax_cents"))}</Td>
              <Td className="tabular-nums">{money(sum("fee_cents"))}</Td>
              <Td className="tabular-nums">{money(sum("refunded_cents"))}</Td>
              <Td className="tabular-nums">{money(sum("net_cents"))}</Td>
            </tr>
          </Table>
        ) : (
          <Empty>No payments in this period.</Empty>
        )}
        <p className="mt-3 text-xs text-muted">
          Net = amount charged − processing fees − refunds. Tax is collected on behalf of the tax authority and is shown separately; it is not income. Failed payments are excluded.
        </p>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active members" value={stats.active_members ?? 0} hint={`${stats.past_due_members ?? 0} past due · ${stats.frozen_members ?? 0} frozen`} />
        <Stat label="New / cancelled" value={`${stats.new_memberships ?? 0} / ${stats.cancelled_memberships ?? 0}`} hint={stats.churn_rate != null ? `Recurring churn ${(Number(stats.churn_rate) * 100).toFixed(1)}%` : "Recurring churn: not enough history"} />
        <Stat label="Class attendance" value={stats.attendance ?? 0} hint={`${stats.classes_held ?? 0} classes · ${stats.no_shows ?? 0} no-shows`} />
        <Stat label="Program enrolments" value={stats.active_enrollments ?? 0} hint={`${stats.new_enrollments ?? 0} new · ${stats.workouts_logged ?? 0} workouts logged`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Failed payments" actions={<Link href={exportHref("members")} className="text-xs underline">Export memberships (CSV)</Link>}>
          {failed?.length ? (
            <Table head={["When", "Member", "For", "Amount", "Reason"]}>
              {failed.map((p) => (
                <tr key={p.id}>
                  <Td className="text-muted">{formatDateTime(p.created_at, gym.timezone)}</Td>
                  <Td>{p.user_id ? <Link href={`/admin/members/${p.user_id}`} className="hover:underline">{p.profiles?.full_name || p.profiles?.email}</Link> : "—"}</Td>
                  <Td>{p.description}</Td>
                  <Td className="tabular-nums">{money(p.amount_cents, p.currency)}</Td>
                  <Td className="text-muted">{p.failure_reason}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No failed payments.</Empty>
          )}
          <p className="mt-3 text-xs text-muted">Stripe retries failed subscription payments automatically and emails the member. The membership shows as past due until it is paid or Stripe gives up and cancels it.</p>
        </Card>

        <Card title="Payouts to bank" actions={<Link href={exportHref("attendance")} className="text-xs underline">Export attendance (CSV)</Link>}>
          {payouts?.length ? (
            <Table head={["Arrival", "Amount", "Status", "Stripe payout"]}>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <Td>{p.arrival_date ? formatDate(p.arrival_date, { month: "short", day: "numeric", year: "numeric" }) : "—"}</Td>
                  <Td className="tabular-nums">{money(p.amount_cents, p.currency)}</Td>
                  <Td><Badge tone={p.status === "paid" ? "good" : p.status === "failed" ? "bad" : "warn"}>{p.status.replace(/_/g, " ")}</Badge></Td>
                  <Td className="font-mono text-xs text-muted">{p.stripe_payout_id}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No payouts recorded yet.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}

function RevenueGroup({ children }: { label: string; children: React.ReactNode }) {
  return <>{children}</>;
}
