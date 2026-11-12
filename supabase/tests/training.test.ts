import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, anon, gymId, makeMember, newAthlete, service, signIn } from "./helpers";

let alex: SupabaseClient;
let gym: string;
let today: string;
let program: { id: string; duration_weeks: number; grace_days: number };

beforeAll(async () => {
  alex = await signIn("alex@furyco.test");
  gym = await gymId();
  today = (await service().rpc("gym_today", { p_gym: gym })).data;
  program = (
    await service().from("programs").select("id, duration_weeks, grace_days").eq("slug", "selection-prep-6").single()
  ).data!;
});

async function enroll(userId: string, startDate: string) {
  const { data, error } = await service()
    .from("enrollments")
    .insert({ gym_id: gym, program_id: program.id, user_id: userId, start_date: startDate })
    .select()
    .single();
  if (error) throw error;
  return data;
}

describe("my_calendar", () => {
  it("places program days from the athlete's own start date", async () => {
    const a = await newAthlete("cal-a");
    const b = await newAthlete("cal-b");
    const startA = addDays(today, 3);
    const startB = addDays(today, 10);
    const ea = await enroll(a.id, startA);
    await enroll(b.id, startB);

    const calA = await a.client.rpc("my_calendar", { p_from: today, p_to: addDays(today, 120) });
    const calB = await b.client.rpc("my_calendar", { p_from: today, p_to: addDays(today, 120) });
    expect(calA.data).toHaveLength(30);
    expect(calB.data).toHaveLength(30);

    const dayA = (w: number, d: number) => calA.data.find((r: any) => r.week === w && r.day === d);
    expect(dayA(1, 1).calendar_date).toBe(startA);
    expect(dayA(1, 5).calendar_date).toBe(addDays(startA, 4));
    expect(dayA(3, 2).calendar_date).toBe(addDays(startA, 15));
    expect(dayA(6, 5).calendar_date).toBe(addDays(startA, 39));
    expect(calB.data.find((r: any) => r.week === 1 && r.day === 1).calendar_date).toBe(startB);
    expect(dayA(1, 1).source).toBe("program");
    expect(dayA(1, 1).enrollment_id).toBe(ea.id);

    // default expiry: last program day + grace
    expect(ea.expires_at).toBe(addDays(startA, program.duration_weeks * 7 - 1 + program.grace_days));

    // no facility workouts without a facility membership
    expect(calA.data.every((r: any) => r.source === "program")).toBe(true);
  });

  it("unlocks week by week and hides locked workout content", async () => {
    // seeded: Alex started 9 days ago → weeks 1-2 open, weeks 3-6 locked
    const cal = await alex.rpc("my_calendar", { p_from: addDays(today, -30), p_to: addDays(today, 60) });
    const programDays = cal.data.filter((r: any) => r.source === "program");
    expect(programDays).toHaveLength(30);
    for (const row of programDays) {
      expect(row.locked, `week ${row.week}`).toBe(row.week > 2);
    }
    expect(programDays.filter((r: any) => r.week === 1).every((r: any) => r.log_id !== null)).toBe(true);

    const open = programDays.find((r: any) => r.week === 2 && r.day === 1);
    const locked = programDays.find((r: any) => r.week === 3 && r.day === 1);
    expect((await alex.from("workouts").select("id").eq("id", open.workout_id)).data).toHaveLength(1);
    expect((await alex.from("workout_items").select("id").eq("workout_id", open.workout_id)).data!.length).toBeGreaterThan(0);
    expect((await alex.from("workouts").select("id").eq("id", locked.workout_id)).data).toHaveLength(0);
    expect((await alex.from("workout_items").select("id").eq("workout_id", locked.workout_id)).data).toHaveLength(0);

    const blocked = await alex.rpc("submit_workout_log", {
      p_workout: locked.workout_id,
      p_performed_on: today,
      p_entries: [],
      p_enrollment: locked.enrollment_id,
    });
    expect(blocked.error?.message).toBe("workout_locked");
  });

  it("merges facility workouts for members and shows nothing that is unpublished", async () => {
    const cal = await alex.rpc("my_calendar", { p_from: today, p_to: today });
    const facility = cal.data.filter((r: any) => r.source === "facility");
    expect(facility.map((r: any) => r.track_name).sort()).toEqual(["Engine", "Strength"]);

    // tomorrow's workouts publish at 18:00 today, so the result depends on the clock — check against the table
    const tomorrow = addDays(today, 1);
    const { data: rows } = await service()
      .from("workouts")
      .select("id, publish_at")
      .eq("scheduled_date", tomorrow)
      .eq("status", "published");
    const expected = rows!.filter((w) => new Date(w.publish_at).getTime() <= Date.now()).length;
    const next = await alex.rpc("my_calendar", { p_from: tomorrow, p_to: tomorrow });
    expect(next.data.filter((r: any) => r.source === "facility")).toHaveLength(expected);

    const dayNine = await alex.rpc("my_calendar", { p_from: addDays(today, 9), p_to: addDays(today, 9) });
    expect(dayNine.data.filter((r: any) => r.source === "facility")).toHaveLength(0); // only a draft exists
  });

  it("ends access after the expiry date but keeps logged history", async () => {
    const a = await newAthlete("expired");
    const e = await enroll(a.id, addDays(today, -80));
    expect(e.expires_at < today).toBe(true);
    const cal = await a.client.rpc("my_calendar", { p_from: addDays(today, -90), p_to: today });
    expect(cal.data.length).toBe(30);
    expect(cal.data.every((r: any) => r.locked)).toBe(true);
    expect((await a.client.from("workouts").select("id")).data).toHaveLength(0);
  });
});

describe("set_enrollment_start", () => {
  it("lets an athlete move a future start date and carries the expiry with it", async () => {
    const a = await newAthlete("shift");
    const e = await enroll(a.id, addDays(today, 5));
    const moved = await a.client.rpc("set_enrollment_start", { p_enrollment: e.id, p_start: addDays(today, 12) });
    expect(moved.error).toBeNull();
    expect(moved.data.start_date).toBe(addDays(today, 12));
    expect(moved.data.expires_at).toBe(addDays(e.expires_at, 7));

    expect(
      (await a.client.rpc("set_enrollment_start", { p_enrollment: e.id, p_start: addDays(today, -1) })).error?.message,
    ).toBe("start_date_in_past");
  });

  it("refuses once the program has started, unless staff do it", async () => {
    const e = (await alex.from("enrollments").select("id, start_date, expires_at").single()).data!;
    const self = await alex.rpc("set_enrollment_start", { p_enrollment: e.id, p_start: addDays(today, 2) });
    expect(self.error?.message).toBe("program_already_started");

    const other = await newAthlete("nosy");
    expect(
      (await other.client.rpc("set_enrollment_start", { p_enrollment: e.id, p_start: addDays(today, 2) })).error,
    ).not.toBeNull();

    const coach = await signIn("coach@furyco.test");
    const byStaff = await coach.rpc("set_enrollment_start", { p_enrollment: e.id, p_start: e.start_date });
    expect(byStaff.error).toBeNull();
    expect(byStaff.data.expires_at).toBe(e.expires_at);
  });

  it("athletes cannot extend their own access directly", async () => {
    const e = (await alex.from("enrollments").select("id").single()).data!;
    const update = await alex.from("enrollments").update({ expires_at: "2099-01-01" }).eq("id", e.id).select();
    expect(update.data ?? []).toHaveLength(0);
  });
});

describe("submit_workout_log", () => {
  it("stores the coach-configured metrics and flags personal records", async () => {
    const athlete = await newAthlete("lifter");
    await makeMember(athlete.id);
    const { data: workout } = await athlete.client
      .from("workouts")
      .select("id, workout_items(id, title, metrics, exercise_id)")
      .eq("scheduled_date", today)
      .eq("title", "Squat Day")
      .single();
    const squat = (workout as any).workout_items.find((i: any) => i.title === "Back Squat");
    expect(squat.metrics).toEqual(["load", "reps", "rpe"]);

    const first = await athlete.client.rpc("submit_workout_log", {
      p_workout: workout!.id,
      p_performed_on: today,
      p_notes: "First go",
      p_rpe: 8,
      p_entries: [
        { workout_item_id: squat.id, set_index: 1, load: 225, load_unit: "lb", reps: 5, rpe: 7 },
        { workout_item_id: squat.id, set_index: 2, load: 235, load_unit: "lb", reps: 5, rpe: 8 },
      ],
    });
    expect(first.error).toBeNull();
    expect(first.data.prs.length).toBeGreaterThan(0);

    // resubmitting replaces the log rather than duplicating it
    const second = await athlete.client.rpc("submit_workout_log", {
      p_workout: workout!.id,
      p_performed_on: today,
      p_entries: [{ workout_item_id: squat.id, set_index: 1, load: 100, load_unit: "kg", reps: 5 }],
    });
    expect(second.data.log_id).toBe(first.data.log_id);
    const entries = await athlete.client.from("workout_log_entries").select("load, load_unit, load_kg, reps");
    expect(entries.data).toEqual([{ load: 100, load_unit: "kg", load_kg: 100, reps: 5 }]);

    const records = await athlete.client.from("personal_records").select("exercise_name, reps, load_kg");
    expect(records.data).toEqual([{ exercise_name: "Back Squat", reps: 5, load_kg: 100 }]);

    // the calendar now shows the workout as logged
    const cal = await athlete.client.rpc("my_calendar", { p_from: today, p_to: today });
    expect(cal.data.find((r: any) => r.workout_id === workout!.id).log_id).toBe(first.data.log_id);
  });

  it("only flags a PR when the previous best for that rep count is beaten", async () => {
    // Alex's seeded best back squat is 235 lb x 5
    const { data: best } = await alex.from("personal_records").select("load, reps").eq("exercise_name", "Back Squat").eq("reps", 5).single();
    expect(best).toEqual({ load: 235, reps: 5 });

    const { data: workout } = await alex
      .from("workouts")
      .select("id, workout_items(id, title)")
      .eq("scheduled_date", today)
      .eq("title", "Squat Day")
      .single();
    const squat = (workout as any).workout_items.find((i: any) => i.title === "Back Squat");
    const submit = (load: number) =>
      alex.rpc("submit_workout_log", {
        p_workout: workout!.id,
        p_performed_on: today,
        p_entries: [{ workout_item_id: squat.id, load, load_unit: "lb", reps: 5 }],
      });

    expect((await submit(230)).data.prs).toHaveLength(0);
    const better = await submit(240);
    expect(better.data.prs).toHaveLength(1);
    expect(better.data.prs[0].title).toBe("Back Squat");
    await alex.from("workout_logs").delete().eq("id", better.data.log_id);
  });

  it("treats a faster benchmark time as a PR", async () => {
    const admin = service();
    const athlete = await newAthlete("rower");
    await makeMember(athlete.id);
    const coach = await signIn("coach@furyco.test");
    const make = async (date: string) => {
      const { data: w } = await coach
        .from("workouts")
        .insert({ gym_id: gym, title: "2k Row Test", scheduled_date: date, status: "published", publish_at: new Date(Date.now() - 1000).toISOString() })
        .select()
        .single();
      const { data: item } = await coach
        .from("workout_items")
        .insert({ workout_id: w!.id, title: "2k Row", metrics: ["benchmark", "time"], benchmark_name: "2k Row" })
        .select()
        .single();
      return { workout: w!, item: item! };
    };
    const a = await make(addDays(today, -2));
    const b = await make(addDays(today, -1));
    const c = await make(today);
    const log = (x: typeof a, seconds: number) =>
      athlete.client.rpc("submit_workout_log", {
        p_workout: x.workout.id,
        p_performed_on: x.workout.scheduled_date,
        p_entries: [{ workout_item_id: x.item.id, time_seconds: seconds }],
      });

    expect((await log(a, 480)).data.prs).toHaveLength(1);
    expect((await log(b, 495)).data.prs).toHaveLength(0);
    expect((await log(c, 472.5)).data.prs).toHaveLength(1);

    const results = await athlete.client.from("benchmark_results").select("time_seconds, is_pr").order("performed_on");
    expect(results.data).toEqual([
      { time_seconds: 480, is_pr: true },
      { time_seconds: 495, is_pr: false },
      { time_seconds: 472.5, is_pr: true },
    ]);
    await athlete.client.from("workout_logs").delete().eq("user_id", athlete.id).throwOnError();
    await admin.from("workouts").delete().in("id", [a.workout.id, b.workout.id, c.workout.id]).throwOnError();
  });

  it("rejects items from another workout and logs against someone else's enrollment", async () => {
    const { data: workouts } = await alex.from("workouts").select("id, workout_items(id)").eq("scheduled_date", today);
    const [w1, w2] = workouts as any[];
    const wrongItem = await alex.rpc("submit_workout_log", {
      p_workout: w1.id,
      p_performed_on: today,
      p_entries: [{ workout_item_id: w2.workout_items[0].id, reps: 1 }],
    });
    expect(wrongItem.error?.message).toBe("invalid_workout_item");

    const other = await newAthlete("intruder");
    const e = (await alex.from("enrollments").select("id").single()).data!;
    const wrongEnrollment = await other.client.rpc("submit_workout_log", {
      p_workout: w1.id,
      p_performed_on: today,
      p_entries: [],
      p_enrollment: e.id,
    });
    expect(wrongEnrollment.error).not.toBeNull();
  });
});

describe("coach feedback", () => {
  it("is written by staff and read by the athlete it is for", async () => {
    const coach = await signIn("coach@furyco.test");
    const coachId = (await coach.auth.getUser()).data.user!.id;
    const { data: log } = await alex.from("workout_logs").select("id").limit(1).single();

    const fromAthlete = await alex.from("coach_feedback").insert({ log_id: log!.id, coach_id: (await alex.auth.getUser()).data.user!.id, body: "nice" });
    expect(fromAthlete.error).not.toBeNull();

    const fromCoach = await coach.from("coach_feedback").insert({ log_id: log!.id, coach_id: coachId, body: "Strong work." }).select().single();
    expect(fromCoach.error).toBeNull();
    const seen = await alex.from("coach_feedback").select("body").eq("id", fromCoach.data!.id).single();
    expect(seen.data!.body).toBe("Strong work.");

    const other = await newAthlete("reader");
    expect((await other.client.from("coach_feedback").select("id")).data).toHaveLength(0);
    await coach.from("coach_feedback").delete().eq("id", fromCoach.data!.id);
  });
});

describe("get_display", () => {
  it("returns today's published workouts for a valid token and nothing for a bad one", async () => {
    const client = anon();
    expect((await client.rpc("get_display", { p_token: "wrong" })).data).toBeNull();

    const { data } = await client.rpc("get_display", { p_token: "demo-display-token" });
    expect(data.gym).toBe("Fury Co. Athletics");
    expect(data.date).toBe(today);
    expect(data.workouts.map((w: any) => w.track)).toEqual(["Strength", "Engine"]);
    expect(data.workouts[0].items.length).toBeGreaterThan(0);
    expect(data.workouts[0].coach_notes).toBeNull(); // hidden unless staff switch it on
  });

  it("follows staff control: one track, a pinned workout, a message, or off", async () => {
    const coach = await signIn("coach@furyco.test");
    const client = anon();
    const show = async () => (await client.rpc("get_display", { p_token: "demo-display-token" })).data;
    const { data: engine } = await coach.from("tracks").select("id").eq("slug", "engine").single();
    const { data: template } = await coach.from("workouts").select("id").eq("title", "Benchmark: 2k Row").single();

    await coach.from("display_state").update({ track_id: engine!.id, show_coach_notes: true }).eq("gym_id", gym);
    expect((await show()).workouts.map((w: any) => w.track)).toEqual(["Engine"]);

    // a draft cannot be put on screen
    await coach.from("display_state").update({ mode: "manual", workout_id: template!.id, track_id: null }).eq("gym_id", gym);
    expect((await show()).workouts).toHaveLength(0);

    const { data: live } = await coach.from("workouts").select("id, title").eq("scheduled_date", addDays(today, -1)).eq("title", "Pull Day").single();
    await coach.from("display_state").update({ workout_id: live!.id, message: "Open gym until 8pm" }).eq("gym_id", gym);
    const pinned = await show();
    expect(pinned.workouts.map((w: any) => w.title)).toEqual(["Pull Day"]);
    expect(pinned.workouts[0].coach_notes).toContain("bar path");
    expect(pinned.message).toBe("Open gym until 8pm");

    await coach.from("display_state").update({ mode: "off" }).eq("gym_id", gym);
    expect((await show()).workouts).toHaveLength(0);

    const athleteWrite = await alex.from("display_state").update({ mode: "auto" }).eq("gym_id", gym).select();
    expect(athleteWrite.data ?? []).toHaveLength(0);

    await coach
      .from("display_state")
      .update({ mode: "auto", workout_id: null, track_id: null, message: null, show_coach_notes: false })
      .eq("gym_id", gym);
  });
});

describe("reports", () => {
  it("separates gross, tax, fees, refunds and net by revenue stream", async () => {
    const owner = await signIn("owner@furyco.test");
    const { data, error } = await owner.rpc("report_revenue", { p_gym: gym, p_from: addDays(today, -90), p_to: today });
    expect(error).toBeNull();
    const row = (kind: string) => data.find((r: any) => r.kind === kind);

    expect(row("membership")).toMatchObject({
      revenue_stream: "facility", payments: 2, gross_cents: 37000, fee_cents: 1134, refunded_cents: 0, net_cents: 35866,
    });
    expect(row("class_pack")).toMatchObject({ payments: 1, gross_cents: 20000, fee_cents: 610, net_cents: 19390 });
    // a fully refunded drop-in still cost the processing fee
    expect(row("drop_in")).toMatchObject({ gross_cents: 2500, refunded_cents: 2500, fee_cents: 103, net_cents: -103 });
    expect(row("program")).toMatchObject({ revenue_stream: "digital", gross_cents: 14900, fee_cents: 462, net_cents: 14438 });
    // failed payments are not revenue
    expect(data.reduce((n: number, r: any) => n + Number(r.payments), 0)).toBe(5);
  });

  it("summarises members, attendance and failed payments for admins only", async () => {
    const owner = await signIn("owner@furyco.test");
    const { data, error } = await owner.rpc("report_overview", { p_gym: gym, p_from: addDays(today, -30), p_to: today });
    expect(error).toBeNull();
    expect(data.active_members).toBeGreaterThanOrEqual(2);
    expect(data.failed_payments).toBe(1);
    expect(data.attendance).toBeGreaterThan(0);
    expect(data.payouts_cents).toBe(51761);
    expect(data.workouts_logged).toBeGreaterThan(0);

    expect((await alex.rpc("report_overview", { p_gym: gym, p_from: today, p_to: today })).error).not.toBeNull();
  });
});
