import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newAthlete, service } from "./helpers";

// A separate gym, so publishing here never asks the seeded athletes to re-sign.
let gym: string;
let admin: SupabaseClient;
let coach: SupabaseClient;
let athlete: SupabaseClient;

const TEXT = "I understand the risks of training and accept them on my own behalf.";
const waivers = async () => {
  const { data, error } = await service().from("waivers").select("id, version, active, title").eq("gym_id", gym).order("version");
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  const db = service();
  const { data, error } = await db.from("gyms").insert({ name: "Waiver test gym", slug: `waiver-test-${Date.now()}` }).select("id").single();
  if (error) throw error;
  gym = data.id;
  const people = await Promise.all([newAthlete("waiver-admin"), newAthlete("waiver-coach"), newAthlete("waiver-athlete")]);
  const roles = ["admin", "coach", "athlete"] as const;
  for (const [i, person] of people.entries()) {
    const { error: e } = await db.from("gym_members").upsert({ gym_id: gym, user_id: person.id, role: roles[i] }, { onConflict: "gym_id,user_id" });
    if (e) throw e;
  }
  [admin, coach, athlete] = people.map((p) => p.client);
});

afterAll(async () => {
  await service().from("gyms").delete().eq("id", gym);
});

describe("publishing a waiver", () => {
  it("only an admin of that gym can publish", async () => {
    for (const client of [coach, athlete]) {
      const { error } = await client.rpc("publish_waiver", { p_gym: gym, p_title: "Waiver", p_body: TEXT });
      expect(error?.code).toBe("42501");
    }
    expect(await waivers()).toHaveLength(0);
  });

  it("retires the old version and numbers the new one, leaving exactly one in force", async () => {
    const first = await admin.rpc("publish_waiver", { p_gym: gym, p_title: " Waiver ", p_body: TEXT });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ version: 1, active: true, title: "Waiver" });
    const second = await admin.rpc("publish_waiver", { p_gym: gym, p_title: "Waiver, revised", p_body: TEXT });
    expect(second.data).toMatchObject({ version: 2, active: true });
    expect((await waivers()).map((w) => [w.version, w.active])).toEqual([[1, false], [2, true]]);
  });

  it("a publish that fails leaves the current waiver in force", async () => {
    const { error } = await admin.rpc("publish_waiver", { p_gym: gym, p_title: "Too short", p_body: "No." });
    expect(error?.message).toBe("waiver_text_required");
    expect((await waivers()).filter((w) => w.active).map((w) => w.version)).toEqual([2]);
  });

  it("two admins publishing at once both succeed, with consecutive versions and one in force", async () => {
    const before = (await waivers()).length;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => admin.rpc("publish_waiver", { p_gym: gym, p_title: `Concurrent ${i}`, p_body: TEXT })),
    );
    expect(results.map((r) => r.error)).toEqual(Array(6).fill(null));
    const all = await waivers();
    expect(all.map((w) => w.version)).toEqual(Array.from({ length: before + 6 }, (_, i) => i + 1));
    expect(all.filter((w) => w.active)).toHaveLength(1);
    expect(all.at(-1)!.active).toBe(true);
  });

  it("the database refuses a second waiver in force, and a repeated version number", async () => {
    const db = service();
    const second = await db.from("waivers").insert({ gym_id: gym, title: "Second", body: TEXT, version: 99, active: true });
    expect(second.error?.code).toBe("23505");
    const repeat = await db.from("waivers").insert({ gym_id: gym, title: "Repeat", body: TEXT, version: 1, active: false });
    expect(repeat.error?.code).toBe("23505");
  });
});
