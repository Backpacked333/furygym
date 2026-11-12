import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LocalEnv = { url: string; anonKey: string; serviceKey: string };

let cached: LocalEnv | undefined;

/** Connection details for the local stack: env vars if set, otherwise `supabase status`. */
export function localEnv(): LocalEnv {
  if (cached) return cached;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    cached = {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    return cached;
  }
  const raw = execSync("pnpm exec supabase status -o json", {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  cached = { url: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
  return cached;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function anon(): SupabaseClient {
  const env = localEnv();
  return createClient(env.url, env.anonKey, options);
}

export function service(): SupabaseClient {
  const env = localEnv();
  return createClient(env.url, env.serviceKey, options);
}

export const DEMO_PASSWORD = "FuryDemo123!";

export async function signIn(email: string, password = DEMO_PASSWORD): Promise<SupabaseClient> {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return client;
}

let counter = 0;

/** Creates a throwaway athlete and returns a signed-in client for them. */
export async function newAthlete(label = "athlete") {
  const email = `${label}-${Date.now()}-${counter++}@test.furyco.test`;
  const admin = service();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test ${label}` },
  });
  if (error || !data.user) throw new Error(`create user failed: ${error?.message}`);
  return { id: data.user.id, email, client: await signIn(email) };
}

export async function gymId(): Promise<string> {
  const { data, error } = await service().from("gyms").select("id").eq("is_default", true).single();
  if (error) throw error;
  return data.id;
}

/** Gives a user an unlimited comp membership and signs every required waiver for them. */
export async function makeMember(userId: string, opts: { credits?: number | null; sign?: boolean } = {}) {
  const admin = service();
  const gym = await gymId();
  const kind = opts.credits == null ? "recurring" : "class_pack";
  const { data: plan } = await admin.from("membership_plans").select("id").eq("kind", kind).limit(1).single();
  const { data: membership, error } = await admin
    .from("memberships")
    .insert({ gym_id: gym, user_id: userId, plan_id: plan!.id, credits_remaining: opts.credits ?? null })
    .select()
    .single();
  if (error) throw error;
  if (opts.sign !== false) {
    const { data: waivers } = await admin.from("waivers").select("id").eq("required", true).eq("active", true);
    for (const w of waivers ?? []) {
      await admin
        .from("waiver_signatures")
        .insert({ waiver_id: w.id, gym_id: gym, user_id: userId, signed_name: "Test Athlete" });
    }
  }
  return membership;
}

/** A class starting `hoursFromNow` hours from now. */
export async function newSession(capacity: number, hoursFromNow = 48) {
  const gym = await gymId();
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const { data, error } = await service()
    .from("class_sessions")
    .insert({
      gym_id: gym,
      title: `Test class ${Date.now()}-${counter++}`,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 3600_000).toISOString(),
      capacity,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
