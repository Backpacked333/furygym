import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "FuryDemo123!";

let cached: { url: string; anonKey: string; serviceKey: string } | undefined;

function localEnv() {
  if (cached) return cached;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    cached = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
    return cached;
  }
  const raw = execSync("pnpm exec supabase status -o json", { cwd: `${__dirname}/../../..`, stdio: ["ignore", "pipe", "ignore"] }).toString();
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  cached = { url: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
  return cached;
}

const auth = { persistSession: false, autoRefreshToken: false };

/** Service-role client for checking what actually landed in the database. */
export function db() {
  const env = localEnv();
  return createClient(env.url, env.serviceKey, { auth });
}

/** A Supabase client signed in as a user — what the iOS app would see. */
export async function asUser(email: string, password = PASSWORD) {
  const env = localEnv();
  const client = createClient(env.url, env.anonKey, { auth });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function gymToday(): Promise<string> {
  const client = db();
  const { data: gym } = await client.from("gyms").select("id").eq("is_default", true).single();
  const { data } = await client.rpc("gym_today", { p_gym: gym!.id });
  return data as string;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
