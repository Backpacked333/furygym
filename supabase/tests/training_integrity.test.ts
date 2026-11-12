import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { gymId, makeMember, newAthlete as createAthlete, service, signIn } from "./helpers";

const athletes: string[] = [];
const workouts: string[] = [];
async function newAthlete(label: string) {
  const athlete = await createAthlete(label);
  athletes.push(athlete.id);
  return athlete;
}
afterEach(async () => {
  for (const id of athletes.splice(0)) await service().auth.admin.deleteUser(id);
  for (const id of workouts.splice(0)) await service().from("workouts").delete().eq("id", id).throwOnError();
});

let gym: string;
let today: string;
beforeAll(async () => {
  gym = await gymId();
  today = (await service().rpc("gym_today", { p_gym: gym })).data;
});

async function workout() {
  const db = service();
  const exercise = (await db.from("exercises").select("id").eq("name", "Back Squat").single()).data!;
  const { data: row, error } = await db.from("workouts").insert({ gym_id: gym, title: "Integrity test", status: "published", publish_at: new Date().toISOString(), scheduled_date: today }).select().single();
  if (error) throw error;
  workouts.push(row.id);
  const item = await db.from("workout_items").insert({ workout_id: row.id, title: "Back Squat", exercise_id: exercise.id, metrics: ["load", "reps"] }).select().single();
  if (item.error) throw item.error;
  return { id: row.id, item: item.data.id };
}

describe("workout integrity", () => {
  it("prevents deleting logged workouts below the UI but permits deleting unused workouts", async () => {
    const athlete = await newAthlete("retained-history");
    await makeMember(athlete.id);
    const w = await workout();
    const saved = await athlete.client.rpc("submit_workout_log", { p_workout: w.id, p_performed_on: today, p_entries: [] });
    expect(saved.error).toBeNull();
    const owner = await signIn("owner@furyco.test");
    expect((await owner.from("workouts").delete().eq("id", w.id)).error?.code).toBe("23503");
    expect((await athlete.client.from("workout_logs").select("id").eq("id", saved.data.log_id)).data).toHaveLength(1);
    const unused = await workout();
    expect((await owner.from("workouts").delete().eq("id", unused.id)).error).toBeNull();
    expect((await service().auth.admin.deleteUser(athlete.id)).error).toBeNull();
  });

  it("serializes first-time retries and keeps one complete log", async () => {
    const athlete = await newAthlete("simultaneous-log");
    await makeMember(athlete.id);
    const w = await workout();
    const args = { p_workout: w.id, p_performed_on: today, p_notes: "All entries retained", p_entries: [{ workout_item_id: w.item, set_index: 1, load: 100, load_unit: "kg", reps: 5 }] };
    const results = await Promise.all(Array.from({ length: 8 }, () => athlete.client.rpc("submit_workout_log", args)));
    expect(results.map((r) => r.error)).toEqual(Array(8).fill(null));
    expect(new Set(results.map((r) => r.data.log_id)).size).toBe(1);
    const logs = await athlete.client.from("workout_logs").select("notes, workout_log_entries(load)");
    expect(logs.data).toEqual([{ notes: "All entries retained", workout_log_entries: [{ load: 100 }] }]);
  });

  it("does not award lower same-rep sets another PR in the same workout", async () => {
    const athlete = await newAthlete("descending-pr");
    await makeMember(athlete.id);
    const w = await workout();
    const result = await athlete.client.rpc("submit_workout_log", { p_workout: w.id, p_performed_on: today,
      p_entries: [150, 100, 125].map((load, index) => ({ workout_item_id: w.item, set_index: index + 1, load, load_unit: "kg", reps: 5 })) });
    expect(result.error).toBeNull();
    expect(result.data.prs).toHaveLength(1);
    expect(result.data.prs[0].load_kg).toBe(150);
    const entries = await athlete.client.from("workout_log_entries").select("is_pr").order("set_index");
    expect(entries.data).toEqual([{ is_pr: true }, { is_pr: false }, { is_pr: false }]);
  });

  it("requires the exact active enrollment for a new log while preserving editing of owned history", async () => {
    const athlete = await newAthlete("enrollment-context");
    const db = service();
    const program = (await db.from("programs").select("id").eq("slug", "selection-prep-6").single()).data!;
    const w = (await db.from("program_workouts").select("workout_id").eq("program_id", program.id).eq("week", 1).eq("day", 1).single()).data!;
    const row = { gym_id: gym, user_id: athlete.id, program_id: program.id, start_date: today };
    const paused = await db.from("enrollments").insert({ ...row, status: "paused" }).select().single();
    const active = await db.from("enrollments").insert(row).select().single();
    expect(paused.error).toBeNull(); expect(active.error).toBeNull();
    const args = { p_workout: w.workout_id, p_performed_on: today, p_entries: [] };
    expect((await athlete.client.rpc("submit_workout_log", { ...args, p_enrollment: paused.data!.id })).error?.message).toBe("workout_locked");
    expect((await athlete.client.rpc("submit_workout_log", args)).error?.message).toBe("workout_locked");
    const saved = await athlete.client.rpc("submit_workout_log", { ...args, p_enrollment: active.data!.id });
    expect(saved.error).toBeNull();
    expect((await db.from("enrollments").update({ status: "paused" }).eq("id", active.data!.id)).error).toBeNull();
    const edited = await athlete.client.rpc("submit_workout_log", { ...args, p_enrollment: active.data!.id, p_notes: "History edit" });
    expect(edited.error).toBeNull();
    expect(edited.data.log_id).toBe(saved.data.log_id);
    expect((await athlete.client.from("workout_logs").select("id")).data).toHaveLength(1);
  });

  it("keeps results for a block the coach later removed when the athlete edits the log", async () => {
    const athlete = await newAthlete("removed-block"); await makeMember(athlete.id);
    const db = service();
    const w = await workout();
    const row = await db.from("workout_items").insert({ workout_id: w.id, title: "Row 2k", position: 1, metrics: ["time"] }).select().single();
    expect(row.error).toBeNull();
    const squat = { workout_item_id: w.item, set_index: 1, load: 200, reps: 5 };
    const saved = await athlete.client.rpc("submit_workout_log", {
      p_workout: w.id, p_performed_on: today, p_entries: [squat, { workout_item_id: row.data!.id, set_index: 1, time_seconds: 450 }],
    });
    expect(saved.error).toBeNull();
    expect((await db.from("workout_items").delete().eq("id", row.data!.id)).error).toBeNull();

    const edited = await athlete.client.rpc("submit_workout_log", { p_workout: w.id, p_performed_on: today, p_entries: [{ ...squat, load: 205 }] });
    expect(edited.error).toBeNull();
    const entries = (await db.from("workout_log_entries").select("workout_item_id, load, time_seconds").eq("log_id", saved.data.log_id)).data!;
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.workout_item_id === null)?.time_seconds).toBe(450);
    expect(entries.find((e) => e.workout_item_id === w.item)?.load).toBe(205);
  });
});
