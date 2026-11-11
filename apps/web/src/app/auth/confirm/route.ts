import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  let destination = type === "email" ? "/login?confirmation=invalid" : "/reset-password?error=invalid-link";
  if (tokenHash && (type === "recovery" || type === "email")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) destination = type === "recovery" ? "/reset-password" : "/login?confirmation=complete";
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: destination } });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
