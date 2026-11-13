import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

// Polled by the TV page. The token is the only credential, so nothing is cached.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/display/[token]">,
) {
  const { token } = await params;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_display", { p_token: token });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  // The page clears itself on this exact answer: the link was replaced, or never existed.
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  // Records that a screen is connected. A staff preview is not a screen; a failed ping never blanks one.
  if (!new URL(request.url).searchParams.has("preview")) {
    await supabase.rpc("display_ping", { p_token: token });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
