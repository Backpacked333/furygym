import type { User } from "@supabase/supabase-js";
import { createClient, createTokenClient } from "@/lib/supabase/server";

/**
 * Identifies the caller of an API route: the iOS app sends its Supabase access token as a Bearer
 * header, the website uses its session cookie. Either way the returned client is bound by RLS.
 */
export async function authenticate(request: Request): Promise<{ user: User; supabase: ReturnType<typeof createTokenClient> } | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    const supabase = createTokenClient(token);
    const { data, error } = await supabase.auth.getUser(token);
    return error || !data.user ? null : { user: data.user, supabase };
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? { user: data.user, supabase: supabase as unknown as ReturnType<typeof createTokenClient> } : null;
}
