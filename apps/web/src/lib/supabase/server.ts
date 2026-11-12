import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";
import { withDeadlockRetry } from "./transaction-fetch";

/** Supabase client for the signed-in browser user (session in cookies). Row-level security applies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: withDeadlockRetry(env.supabaseUrl) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Supabase client acting as the bearer of an access token (the iOS app calling our API routes). */
export function createTokenClient(accessToken: string) {
  return createPlainClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` }, fetch: withDeadlockRetry(env.supabaseUrl) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client. Bypasses row-level security — server-only, for webhooks and admin tasks. */
export function createAdminClient() {
  return createPlainClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    global: { fetch: withDeadlockRetry(env.supabaseUrl) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AppSupabaseClient = ReturnType<typeof createAdminClient>;

/** Client with no user session, for public reads (catalogue, TV display). */
export function createPublicClient() {
  return createPlainClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: withDeadlockRetry(env.supabaseUrl) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
