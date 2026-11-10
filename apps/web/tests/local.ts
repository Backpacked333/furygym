import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let cached: { url: string; anonKey: string; serviceKey: string } | undefined;

/** Connection details for the local Supabase stack: env vars if set, otherwise `supabase status`. */
export function localEnv() {
  if (cached) return cached;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    cached = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
    return cached;
  }
  const raw = execSync("pnpm exec supabase status -o json", { cwd: new URL("../../..", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString();
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  cached = { url: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
  return cached;
}

const auth = { persistSession: false, autoRefreshToken: false };

export function adminClient() {
  const env = localEnv();
  return createClient<Database>(env.url, env.serviceKey, { auth });
}

let counter = 0;

/** A throwaway athlete plus a client signed in as them. */
export async function newAthlete(label: string) {
  const env = localEnv();
  const email = `${label}-${Date.now()}-${counter++}@test.furyco.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: "FuryDemo123!", email_confirm: true, user_metadata: { full_name: `Test ${label}` } });
  if (error || !data.user) throw new Error(`create user failed: ${error?.message}`);
  const client = createClient<Database>(env.url, env.anonKey, { auth });
  await client.auth.signInWithPassword({ email, password: "FuryDemo123!" });
  return { id: data.user.id, email, client };
}
