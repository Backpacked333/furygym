import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Segmented, Stat, Table, Td, buttonClass, type Tone } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addDays, dateInZone, formatDate, money, titleCase, todayInZone, zonedToUtc } from "@/lib/format";

export const metadata = { title: "Revenue" };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const STREAMS: Record<string, { label: string; color: string; tone: Tone }> = {
  membership: { label: "Facility memberships", color: "#ff4245", tone: "accent" },
  program: { label: "Digital programs", color: "#6d7cff", tone: "indigo" },
  packs: { label: "Class packs & drop-ins", color: "#ff9230", tone: "warn" },
};
const streamOf = (kind: string) => (kind === "membership" || kind === "intro" ? "membership" : kind === "program" ? "program" : "packs");

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { supabase, gym } = await requireAdmin();
  const params = await searchParams;
  const today = todayInZone(gym.timezone);
  const to = isDate(params.to) ? params.to : today;
  const from = isDate(params.from) ? params.from : addDays(to, -29);
  const show = params.show === "refunds" || params.show === "failed" ? params.show : "all";
  const start = zonedToUtc(from, "00:00", gym.timezone).toISOString();
  const end = zonedToUtc(addDays(to, 1), "00:00", gym.timezone).toISOString();

  const LIST = 200;
  let listQuery = supabase
    .from("payments")
    .select("id, user_id, kind, description, amount_cents, tax_cents, fee_cents, refunded_cents, currency, status, failure_reason, paid_at, created_at, profiles(full_name)", { count: "exact" })
    .or(`and(paid_at.gte.${start},paid_at.lt.${end}),and(paid_at.is.null,created_at.gte.${start},created_at.lt.${end})`);
  // Filtering in the query, so a refund or failure older than the newest rows is still listed.
  if (show === "refunds") listQuery = listQuery.gt("refunded_cents", 0);
  if (show === "failed") listQuery = listQuery.eq("status", "failed");

  const inPeriod = `and(paid_at.gte.${start},paid_at.lt.${end}),and(paid_at.is.null,created_at.gte.${start},created_at.lt.${end})`;
  const [revenue, overview, { data: payments, count: matching }, { data: payouts }, { count: refunded }] = await Promise.all([
    supabase.rpc("report_revenue", { p_gym: gym.id, p_from: from, p_to: to }),
    supabase.rpc("report_overview", { p_gym: gym.id, p_from: from, p_to: to }),
    listQuery.order("created_at", { ascending: false }).limit(LIST),
    supabase.from("payouts").select("*").order("arrival_date", { ascending: false }).limit(6),
    supabase.from("payments").select("id", { count: "exact", head: true }).or(inPeriod).gt("refunded_cents", 0),
  ]);

  const rows = revenue.data ?? [];
  const stats = (overview.data ?? {}) as Record<string, number | null>;
  const sum = (key: "gross_cents" | "tax_cents" | "fee_cents" | "refunded_cents" | "net_cents" | "payments", stream?: string) =>
    rows.filter((r) => !stream || streamOf(r.kind) === stream).reduce((n, r) => n + Number(r[key]), 0);
  const gross = sum("gross_cents");
  const streams = Object.keys(STREAMS).filter((s) => sum("payments", s) > 0);
  const refundCount = refunded ?? 0;
  const feeRate = gross > 0 ? ((sum("fee_cents") / (gross + sum("tax_cents"))) * 100).toFixed(1) : null;

  const listed = payments ?? [];
  const unlisted = Math.max(0, (matching ?? 0) - listed.length);
  const range = `from=${from}&to=${to}`;
  const exportHref = (type: string) => `/admin/reports/export?type=${type}&${range}`;
  const day = (iso: string | null) => (iso ? formatDate(dateInZone(new Date(iso), gym.timezone), { month: "short", day: "numeric" }) : "—");

  return (
    <>
      <PageHeader
        eyebrow={<>Business · {formatDate(from, { month: "short", day: "numeric" })} – {formatDate(to, { month: "short", day: "numeric", year: "numeric" })}</>}
        title="Revenue"
        actions={
          <>
            <form className="flex items-end gap-2">
              <Field label="From"><Input type="date" name="from" defaultValue={from} className="h-9 py-0" /></Field>
              <Field label="To"><Input type="date" name="to" defaultValue={to} className="h-9 py-0" /></Field>
              <button className={buttonClass("secondary")}>Apply</button>
            </form>
            <LinkButton href={exportHref("payments")}><Icon name="download" size={18} />Export CSV</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Gross sales" value={money(gross)} hint="Before tax, fees and refunds" />
        <Stat label="Processing fees" value={`−${money(sum("fee_cents"))}`} hint={feeRate ? `${feeRate}% effective` : undefined} />
        <Stat label="Refunds" value={`−${money(sum("refunded_cents"))}`} hint={<span data-testid="refund-count">{refundCount} refunded {refundCount === 1 ? "payment" : "payments"}</span>} />
        <Stat label="Tax collected" value={money(sum("tax_cents"))} hint="Liability · not revenue" />
        <Stat label="Net to bank" value={money(sum("net_cents"))} tone="good" hint={`Payouts received ${money(Number(stats.payouts_cents ?? 0))}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.9fr]">
        <div className="space-y-4">
          <Card title="By stream">
            {revenue.error ? (
              <p className="text-sm text-bad">Could not load revenue: {revenue.error.message}</p>
            ) : rows.length ? (
              <>
                <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-fill">
                  {streams.map((s) => <span key={s} style={{ width: `${(sum("gross_cents", s) / Math.max(gross, 1)) * 100}%`, background: STREAMS[s].color }} />)}
                </div>
                <ul className="divide-y divide-line text-[15px]">
                  {streams.map((s) => (
                    <li key={s} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="inline-flex items-center gap-2.5"><span className="size-2 rounded-full" style={{ background: STREAMS[s].color }} />{STREAMS[s].label}</span>
                      <span className="font-semibold tabular-nums">{money(sum("gross_cents", s))}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-3 grid grid-cols-4 gap-2 rounded-2xl bg-raised p-3 text-[13px]" data-testid="revenue-total">
                  <div><dt className="text-muted">Gross · {sum("payments")}</dt><dd className="font-semibold tabular-nums">{money(gross)}</dd></div>
                  <div><dt className="text-muted">Fees</dt><dd className="font-semibold tabular-nums">{money(sum("fee_cents"))}</dd></div>
                  <div><dt className="text-muted">Refunds</dt><dd className="font-semibold tabular-nums">{money(sum("refunded_cents"))}</dd></div>
                  <div><dt className="text-muted">Net</dt><dd className="font-semibold tabular-nums text-good">{money(sum("net_cents"))}</dd></div>
                </dl>
                <p className="mt-3 text-[13px] text-muted">Net = charged − fees − refunds. Tax is collected for the tax authority and is not income. Failed payments are excluded.</p>
              </>
            ) : (
              <Empty>No payments in this period.</Empty>
            )}
          </Card>

          <Card title="Payouts" actions={<span className="text-muted">Stripe → bank</span>}>
            {payouts?.length ? (
              <ul className="divide-y divide-line">
                {payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-16 text-muted">{p.arrival_date ? formatDate(p.arrival_date, { month: "short", day: "numeric" }) : "—"}</span>
                    <span className="flex-1 font-semibold tabular-nums">{money(p.amount_cents, p.currency)}</span>
                    <Badge tone={p.status === "paid" ? "good" : p.status === "failed" ? "bad" : "warn"}>{p.status === "paid" ? "Paid" : p.status === "in_transit" ? "In transit" : titleCase(p.status)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No payouts recorded yet.</Empty>
            )}
          </Card>

          <Card title="Members & attendance" actions={<Link href={exportHref("attendance")} className="underline">Attendance CSV</Link>}>
            <dl className="grid grid-cols-2 gap-3 text-[15px]">
              <div><dt className="text-[13px] text-muted">Active members</dt><dd className="font-semibold tabular-nums">{stats.active_members ?? 0}</dd></div>
              <div><dt className="text-[13px] text-muted">New / cancelled</dt><dd className="font-semibold tabular-nums">{stats.new_memberships ?? 0} / {stats.cancelled_memberships ?? 0}</dd></div>
              <div><dt className="text-[13px] text-muted">Class attendance</dt><dd className="font-semibold tabular-nums">{stats.attendance ?? 0} <span className="font-normal text-muted">in {stats.classes_held ?? 0} classes</span></dd></div>
              <div><dt className="text-[13px] text-muted">Program enrolments</dt><dd className="font-semibold tabular-nums">{stats.active_enrollments ?? 0} <span className="font-normal text-muted">active</span></dd></div>
            </dl>
          </Card>
        </div>

        <Card
          title="Transactions"
          actions={
            <Segmented
              active={show === "refunds" ? "Refunds" : show === "failed" ? "Failed" : "All"}
              options={[{ label: "All", href: `/admin/reports?${range}` }, { label: "Refunds", href: `/admin/reports?${range}&show=refunds` }, { label: "Failed", href: `/admin/reports?${range}&show=failed` }]}
            />
          }
        >
          {listed.length ? (
            <Table head={["Date", "Customer", "Item", "Stream", <span key="g" className="block text-right">Gross</span>, <span key="f" className="block text-right">Fee</span>, <span key="n" className="block text-right">Net</span>]}>
              {listed.map((p) => {
                const failed = p.status === "failed" || p.status === "pending";
                const net = failed ? 0 : p.amount_cents - p.fee_cents - p.refunded_cents;
                return (
                  <tr key={p.id} data-testid="transaction-row" className={failed ? "text-muted" : undefined}>
                    <Td className="whitespace-nowrap">{day(p.paid_at ?? p.created_at)}</Td>
                    <Td>{p.user_id ? <Link href={`/admin/members/${p.user_id}`} className="hover:underline">{p.profiles?.full_name ?? "Member"}</Link> : "Deleted account"}</Td>
                    <Td>
                      {p.description}
                      {p.status === "failed" ? <span className="block text-[13px] text-warn">{p.failure_reason ?? "Payment failed"}</span> : null}
                      {p.refunded_cents > 0 ? <span className="block text-[13px] text-muted">Refunded {money(p.refunded_cents, p.currency)}</span> : null}
                    </Td>
                    <Td><Badge tone={failed ? "neutral" : STREAMS[streamOf(p.kind)].tone}>{failed ? titleCase(p.status) : titleCase(p.kind)}</Badge></Td>
                    <Td className="text-right tabular-nums">{money(p.amount_cents - p.tax_cents, p.currency)}</Td>
                    <Td className="text-right tabular-nums text-muted">{failed ? "—" : `−${money(p.fee_cents, p.currency)}`}</Td>
                    <Td className="text-right font-semibold tabular-nums">{failed ? "—" : money(net, p.currency)}</Td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty>No transactions match.</Empty>
          )}
          {unlisted ? (
            <p className="mt-3 text-[13px] text-muted" data-testid="transactions-more">
              Showing the newest {listed.length} of {listed.length + unlisted}. <Link href={`${exportHref("payments")}${show === "all" ? "" : `&show=${show}`}`} className="underline">Export CSV</Link> for the full list{show === "all" ? "" : show === "refunds" ? " of refunds" : " of failed payments"}.
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
