import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/server";

const answer = (body: Record<string, string>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// For uptime monitors and the launch checklist. Reports whether the app can reach its database
// and which optional services are switched on; never a key, URL or error detail.
export async function GET() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) return answer({ status: "misconfigured", database: "unknown" }, 503);
  }
  const { data, error } = await createPublicClient().from("gyms").select("id").eq("is_default", true).maybeSingle();
  if (error) return answer({ status: "unavailable", database: "unreachable" }, 503);
  if (!data) return answer({ status: "unavailable", database: "no_gym" }, 503);
  return answer(
    { status: "ok", database: "ok", payments: env.stripeSecretKey && env.stripeWebhookSecret ? "on" : "off" },
    200,
  );
}
