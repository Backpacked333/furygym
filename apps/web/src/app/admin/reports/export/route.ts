import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { dollars, toCsv } from "@/lib/csv";
import { addDays, dateInZone, zonedToUtc } from "@/lib/format";

const isDate = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { supabase, gym } = viewer;

  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  const from = params.get("from");
  const to = params.get("to");
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const start = zonedToUtc(from, "00:00", gym.timezone).toISOString();
  const end = zonedToUtc(addDays(to, 1), "00:00", gym.timezone).toISOString();
  const day = (iso: string | null) => (iso ? dateInZone(new Date(iso), gym.timezone) : "");

  let csv: string;
  if (type === "payments") {
    const { data } = await supabase
      .from("payments")
      .select("*, profiles(full_name, email)")
      .or(`and(paid_at.gte.${start},paid_at.lt.${end}),and(paid_at.is.null,created_at.gte.${start},created_at.lt.${end})`)
      .order("created_at");
    csv = toCsv(
      ["date", "customer", "email", "revenue_stream", "type", "description", "status", "gross_sales", "tax", "charged", "processing_fee", "refunded", "net", "currency", "stripe_payment_intent", "stripe_invoice"],
      (data ?? []).map((p) => {
        const counted = p.status !== "failed" && p.status !== "pending";
        return [
          day(p.paid_at ?? p.created_at), p.profiles?.full_name ?? "(deleted account)", p.profiles?.email ?? "", p.revenue_stream, p.kind, p.description, p.status,
          dollars(p.amount_cents - p.tax_cents), dollars(p.tax_cents), dollars(p.amount_cents), dollars(p.fee_cents), dollars(p.refunded_cents),
          counted ? dollars(p.amount_cents - p.fee_cents - p.refunded_cents) : "0.00", p.currency, p.stripe_payment_intent_id, p.stripe_invoice_id,
        ];
      }),
    );
  } else if (type === "members") {
    const { data } = await supabase.from("memberships").select("*, profiles(full_name, email), membership_plans(name, kind)").order("started_at");
    csv = toCsv(
      ["member", "email", "plan", "plan_type", "status", "source", "started", "renews", "ends", "credits_remaining"],
      (data ?? []).map((m) => [m.profiles?.full_name, m.profiles?.email, m.membership_plans?.name, m.membership_plans?.kind, m.status, m.source, day(m.started_at), day(m.current_period_end), day(m.ends_at), m.credits_remaining]),
    );
  } else if (type === "attendance") {
    const { data } = await supabase
      .from("bookings")
      .select("status, late_cancel, checked_in_at, profiles!bookings_user_id_fkey(full_name, email), class_sessions!inner(title, starts_at)")
      .gte("class_sessions.starts_at", start)
      .lt("class_sessions.starts_at", end);
    csv = toCsv(
      ["class_date", "class", "member", "email", "status", "late_cancel", "checked_in_at"],
      (data ?? [])
        .sort((a, b) => a.class_sessions.starts_at.localeCompare(b.class_sessions.starts_at))
        .map((b) => [day(b.class_sessions.starts_at), b.class_sessions.title, b.profiles?.full_name, b.profiles?.email, b.status, b.late_cancel ? "yes" : "", b.checked_in_at ?? ""]),
    );
  } else {
    return NextResponse.json({ error: "unknown_report" }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="furyco-${type}-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
