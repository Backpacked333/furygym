import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anon, gymId, newAthlete, service, signIn } from "./helpers";

let alex: SupabaseClient;
let sam: SupabaseClient;
let jordan: SupabaseClient;
let coach: SupabaseClient;
let owner: SupabaseClient;
let gym: string;

beforeAll(async () => {
  [alex, sam, jordan, coach, owner] = await Promise.all([
    signIn("alex@furyco.test"),
    signIn("sam@furyco.test"),
    signIn("jordan@furyco.test"),
    signIn("coach@furyco.test"),
    signIn("owner@furyco.test"),
  ]);
  gym = await gymId();
});

const ids = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id);

describe("logged-out visitors", () => {
  it("see the public catalogue and nothing else", async () => {
    const client = anon();
    const plans = await client.from("membership_plans").select("id");
    const programs = await client.from("programs").select("id");
    expect(plans.data!.length).toBeGreaterThan(0);
    expect(programs.data!.length).toBeGreaterThan(0);

    for (const table of ["profiles", "workouts", "memberships", "payments", "bookings", "gym_secrets", "workout_logs"]) {
      const { data, error } = await client.from(table).select("*").limit(1);
      expect(error, `${table} should be denied`).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("cannot call athlete RPCs", async () => {
    const { error } = await anon().rpc("my_calendar", { p_from: "2026-01-01", p_to: "2026-01-02" });
    expect(error).not.toBeNull();
  });
});

describe("athletes", () => {
  it("read only their own profile, memberships, payments and logs", async () => {
    const profiles = await alex.from("profiles").select("id, email");
    expect(profiles.data).toHaveLength(1);
    expect(profiles.data![0].email).toBe("alex@furyco.test");

    const memberships = await sam.from("memberships").select("user_id");
    expect(memberships.data!.length).toBeGreaterThan(0);
    const samId = (await sam.auth.getUser()).data.user!.id;
    expect(memberships.data!.every((m) => m.user_id === samId)).toBe(true);

    const alexId = (await alex.auth.getUser()).data.user!.id;
    const payments = await alex.from("payments").select("user_id");
    expect(payments.data!.length).toBeGreaterThan(0);
    expect(payments.data!.every((p) => p.user_id === alexId)).toBe(true);

    const samLogs = await sam.from("workout_logs").select("id");
    expect(samLogs.data).toHaveLength(0); // all seeded logs belong to Alex
    const samEntries = await sam.from("workout_log_entries").select("id");
    expect(samEntries.data).toHaveLength(0);
  });

  it("cannot read the display token, audit log, payouts or other members", async () => {
    expect((await alex.from("gym_secrets").select("*")).data).toHaveLength(0);
    expect((await alex.from("audit_log").select("*")).data).toHaveLength(0);
    expect((await alex.from("payouts").select("*")).data).toHaveLength(0);
    expect((await alex.from("gym_members").select("user_id")).data).toHaveLength(1);
    expect((await alex.from("stripe_events").select("*")).error).not.toBeNull();
  });

  it("cannot promote themselves or grant themselves a membership", async () => {
    const alexId = (await alex.auth.getUser()).data.user!.id;
    const promote = await alex.from("gym_members").update({ role: "admin" }).eq("user_id", alexId).select();
    expect(promote.data ?? []).toHaveLength(0);

    const { data: plan } = await alex.from("membership_plans").select("id").limit(1).single();
    const grant = await jordan
      .from("memberships")
      .insert({ gym_id: gym, user_id: (await jordan.auth.getUser()).data.user!.id, plan_id: plan!.id });
    expect(grant.error).not.toBeNull();

    const pay = await alex.from("payments").update({ refunded_cents: 0 }).eq("user_id", alexId);
    expect(pay.error).not.toBeNull();

    const check = await service().from("gym_members").select("role").eq("user_id", alexId).single();
    expect(check.data!.role).toBe("athlete");
  });

  it("without a membership see no facility workouts", async () => {
    const { data } = await jordan.from("workouts").select("id");
    expect(data).toHaveLength(0);
    const items = await jordan.from("workout_items").select("id");
    expect(items.data).toHaveLength(0);
  });

  it("with a membership see published workouts only once publish_at has passed", async () => {
    const admin = service();
    const { data: all } = await admin
      .from("workouts")
      .select("id, status, publish_at, scheduled_date, is_template")
      .not("scheduled_date", "is", null);
    const now = Date.now();
    const live = all!.filter((w) => w.status === "published" && new Date(w.publish_at).getTime() <= now);
    const future = all!.filter((w) => w.status === "published" && new Date(w.publish_at).getTime() > now);
    const drafts = all!.filter((w) => w.status === "draft");
    expect(live.length).toBeGreaterThan(0);
    expect(future.length).toBeGreaterThan(0);
    expect(drafts.length).toBeGreaterThan(0);

    const { data: visible } = await sam.from("workouts").select("id").not("scheduled_date", "is", null);
    const visibleIds = new Set(ids(visible));
    expect(live.every((w) => visibleIds.has(w.id))).toBe(true);
    expect(future.some((w) => visibleIds.has(w.id))).toBe(false);
    expect(drafts.some((w) => visibleIds.has(w.id))).toBe(false);

    // items follow their workout
    const { data: futureItems } = await sam.from("workout_items").select("id").in("workout_id", ids(future));
    expect(futureItems).toHaveLength(0);
  });

  it("cannot write programming", async () => {
    const insert = await alex.from("workouts").insert({ gym_id: gym, title: "Hacked" });
    expect(insert.error).not.toBeNull();
    const { data: visible } = await alex.from("workouts").select("id").limit(1);
    const update = await alex.from("workouts").update({ title: "Hacked" }).eq("id", visible![0].id).select();
    expect(update.data ?? []).toHaveLength(0);
  });

  it("see staff names but not staff contact details", async () => {
    const { data } = await alex.from("staff_directory").select("*");
    expect(data!.map((s) => s.full_name).sort()).toEqual(["Braydon Owner", "Casey Coach"]);
    expect(Object.keys(data![0])).not.toContain("email");
  });
});

describe("staff", () => {
  it("coaches see drafts, scheduled workouts and member logs, but no financials", async () => {
    const workouts = await coach.from("workouts").select("id, status");
    expect(workouts.data!.some((w) => w.status === "draft")).toBe(true);
    expect((await coach.from("workout_logs").select("id")).data!.length).toBeGreaterThan(0);
    expect((await coach.from("profiles").select("id")).data!.length).toBeGreaterThanOrEqual(5);
    expect((await coach.from("payments").select("id")).data).toHaveLength(0);
    expect((await coach.from("payouts").select("id")).data).toHaveLength(0);
    const report = await coach.rpc("report_revenue", { p_gym: gym, p_from: "2020-01-01", p_to: "2100-01-01" });
    expect(report.error).not.toBeNull();
  });

  it("coaches can write programming but cannot change roles or memberships", async () => {
    const created = await coach
      .from("workouts")
      .insert({ gym_id: gym, title: "Coach test workout", status: "draft" })
      .select()
      .single();
    expect(created.error).toBeNull();
    await coach.from("workouts").delete().eq("id", created.data!.id);

    const alexId = (await alex.auth.getUser()).data.user!.id;
    const promote = await coach.from("gym_members").update({ role: "coach" }).eq("user_id", alexId).select();
    expect(promote.data ?? []).toHaveLength(0);
    const freeze = await coach.from("memberships").update({ status: "frozen" }).eq("user_id", alexId).select();
    expect(freeze.data ?? []).toHaveLength(0);
  });

  it("admins cannot create or demote owners; owners can", async () => {
    const admin = await newAthlete("admin");
    await service().from("gym_members").update({ role: "admin" }).eq("user_id", admin.id);
    const target = await newAthlete("target");
    const ownerId = (await owner.auth.getUser()).data.user!.id;

    const toCoach = await admin.client.from("gym_members").update({ role: "coach" }).eq("user_id", target.id).select();
    expect(toCoach.data).toHaveLength(1);
    const toOwner = await admin.client.from("gym_members").update({ role: "owner" }).eq("user_id", target.id).select();
    expect(toOwner.error ?? (toOwner.data?.length === 0 ? "blocked" : null)).not.toBeNull();
    const demote = await admin.client.from("gym_members").update({ role: "athlete" }).eq("user_id", ownerId).select();
    expect(demote.data ?? []).toHaveLength(0);

    const byOwner = await owner.from("gym_members").update({ role: "admin" }).eq("user_id", target.id).select();
    expect(byOwner.data).toHaveLength(1);
  });

  it("role and membership changes land in the audit log", async () => {
    const { data } = await owner.from("audit_log").select("entity, action").eq("entity", "gym_members").limit(5);
    expect(data!.length).toBeGreaterThan(0);
  });
});

describe("new signups", () => {
  it("get a profile and an athlete membership of the gym automatically", async () => {
    const athlete = await newAthlete("signup");
    const profile = await athlete.client.from("profiles").select("full_name, email").single();
    expect(profile.data).toEqual({ full_name: "Test signup", email: athlete.email });
    const member = await athlete.client.from("gym_members").select("role, gym_id").single();
    expect(member.data).toEqual({ role: "athlete", gym_id: gym });
  });
});
