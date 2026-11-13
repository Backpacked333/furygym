import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gymId, service, signIn } from "./helpers";

let gym: string;
let owner: SupabaseClient;
let coach: SupabaseClient;
let athlete: SupabaseClient;
let original: { id: string; version: number; active: boolean }[];

const TEXT = "I understand the risks of training and accept them on my own behalf.";
const waivers = async () => {
  const { data, error } = await service().from("waivers").select("id, version, active, title").eq("gym_id", gym).order("version");
  if (error) throw error;
  return data;
};
const inForce = async () => (await waivers()).filter((w) => w.active).map((w) => w.version);

beforeAll(async () => {
  gym = await gymId();
  [owner, coach, athlete] = await Promise.all([signIn("owner@furyco.test"), signIn("coach@furyco.test"), signIn("alex@furyco.test")]);
  original = await waivers();
});

// Puts the seeded waiver back in force, so athletes in later test files are not asked to re-sign.
afterAll(async () => {
  const db = service();
  const keep = original.map((w) => w.id);
  await db.from("waivers").delete().eq("gym_id", gym).not("id", "in", `(${keep.join(",")})`);
  for (const w of original.filter((o) => o.active)) await db.from("waivers").update({ active: true }).eq("id", w.id);
  expect((await waivers()).map((w) => [w.id, w.active])).toEqual(original.map((w) => [w.id, w.active]));
});

describe("publishing a waiver", () => {
  it("only an admin can publish", async () => {
    for (const client of [coach, athlete]) {
      const { error } = await client.rpc("publish_waiver", { p_gym: gym, p_title: "Waiver", p_body: TEXT });
      expect(error?.code).toBe("42501");
    }
    expect(await waivers()).toEqual(original);
  });

  it("retires the old version and numbers the new one, leaving exactly one in force", async () => {
    const last = original.at(-1)!.version;
    const { data, error } = await owner.rpc("publish_waiver", { p_gym: gym, p_title: " Waiver, revised ", p_body: TEXT });
    expect(error).toBeNull();
    expect(data).toMatchObject({ version: last + 1, active: true, title: "Waiver, revised" });
    expect(await inForce()).toEqual([last + 1]);
  });

  it("a publish that fails leaves the current waiver in force", async () => {
    const before = await inForce();
    const { error } = await owner.rpc("publish_waiver", { p_gym: gym, p_title: "Too short", p_body: "No." });
    expect(error?.message).toBe("waiver_text_required");
    expect(await inForce()).toEqual(before);
  });

  it("publishing at the same moment gives consecutive versions and one in force", async () => {
    const before = await waivers();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => owner.rpc("publish_waiver", { p_gym: gym, p_title: `Concurrent ${i}`, p_body: TEXT })),
    );
    expect(results.map((r) => r.error)).toEqual(Array(6).fill(null));
    const all = await waivers();
    const first = before.at(-1)!.version + 1;
    expect(all.slice(before.length).map((w) => w.version)).toEqual(Array.from({ length: 6 }, (_, i) => first + i));
    expect(all.filter((w) => w.active)).toEqual([all.at(-1)]);
  });

  it("the database refuses a second waiver in force, and a repeated version number", async () => {
    const db = service();
    const second = await db.from("waivers").insert({ gym_id: gym, title: "Second", body: TEXT, version: 9999, active: true });
    expect(second.error?.code).toBe("23505");
    const repeat = await db.from("waivers").insert({ gym_id: gym, title: "Repeat", body: TEXT, version: original[0].version, active: false });
    expect(repeat.error?.code).toBe("23505");
  });
});
