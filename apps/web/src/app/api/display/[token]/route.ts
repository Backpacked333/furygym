import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

// Polled by the TV page. The token is the only credential, so nothing is cached.
export async function GET(_: Request, { params }: RouteContext<"/api/display/[token]">) {
  const { token } = await params;
  const { data, error } = await createPublicClient().rpc("get_display", { p_token: token });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
