#!/usr/bin/env node
// Captures real responses from the local Supabase stack, using exactly the queries the iOS app
// sends, and saves them as test fixtures for FuryCore. Run after changing the schema or a query:
//
//   pnpm db:reset && node apps/ios/scripts/refresh-fixtures.mjs
//
// The decoding tests then prove the app's models still match what the backend returns.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../Packages/FuryCore/Tests/FuryCoreTests/Fixtures");
const raw = execSync("pnpm exec supabase status -o json", { cwd: join(here, "../../.."), stdio: ["ignore", "pipe", "ignore"] }).toString();
const status = JSON.parse(raw.slice(raw.indexOf("{")));
const base = status.API_URL;
const anon = status.ANON_KEY;

async function signIn(email) {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "FuryDemo123!" }),
  });
  if (!res.ok) throw new Error(`sign in failed: ${await res.text()}`);
  return res.json();
}

const session = await signIn("alex@furyco.test");
const headers = { apikey: anon, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };

async function get(path) {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function rpc(name, body) {
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.json();
}
const save = (name, data) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

mkdirSync(out, { recursive: true });

// Keep these select lists identical to FuryCo/Data/Backend.swift.
const gym = await get("gyms?select=id,name,timezone,booking_window_days,cancel_cutoff_minutes,ios_program_purchase_link&is_default=eq.true");
save("gym", gym);
save("profile", await get(`profiles?select=id,email,full_name,phone,units,emergency_contact_name,emergency_contact_phone&id=eq.${session.user.id}`));

const calendar = await rpc("my_calendar", { p_from: day(-14), p_to: day(28) });
save("calendar", calendar);

const open = calendar.find((e) => e.source === "program" && !e.locked);
const workoutSelect = "id,title,description,coach_notes,scheduled_date,workout_items(id,position,section,title,exercise_id,prescription,scaling,notes,video_url,metrics,benchmark_name)";
save("workout", await get(`workouts?select=${workoutSelect}&id=eq.${open.workout_id}`));

save(
  "logs",
  await get(
    "workout_logs?select=id,workout_id,enrollment_id,performed_on,notes,rpe,workouts(title),workout_log_entries(id,workout_item_id,exercise_id,benchmark_name,set_index,load,load_unit,sets,reps,time_seconds,distance_m,pace_seconds,pace_unit,splits,rpe,comments,is_pr),coach_feedback(id,body,created_at)&order=performed_on.desc&limit=30",
  ),
);
save(
  "classes",
  await get(
    `class_session_overview?select=id,title,starts_at,ends_at,capacity,status,track_name,track_color,coach_name,booked_count,waitlist_count,my_booking_id,my_booking_status,my_waitlist_position&starts_at=gte.${day(-7)}T00:00:00Z&order=starts_at&limit=12`,
  ),
);
save("plans", await get("membership_plans?select=id,name,description,kind,price_cents,currency,billing_interval,class_credits,duration_days&order=position"));
save("memberships", await get("memberships?select=id,status,current_period_end,ends_at,cancel_at_period_end,frozen_until,credits_remaining,membership_plans(name,kind)&order=created_at.desc"));
const programSelect = "id,name,slug,summary,description,duration_weeks,days_per_week,price_cents,currency,unlock_mode,grace_days";
save("programs", await get(`programs?select=${programSelect}&status=eq.published&order=position`));
save("enrollments", await get(`enrollments?select=id,program_id,start_date,expires_at,status,programs(${programSelect})&order=created_at.desc`));
save("waivers", await get("waivers?select=id,title,body,version&active=eq.true&required=eq.true"));
save("records", await get("personal_records?select=exercise_id,exercise_name,reps,load,load_unit,load_kg,performed_on&order=exercise_name"));
save("lift_samples", await get("workout_log_entries?select=exercise_id,load_kg,reps,performed_on&load_kg=not.is.null&exercise_id=not.is.null&order=performed_on"));
save("payments", await get("payments?select=id,description,amount_cents,refunded_cents,currency,status,paid_at,created_at&order=created_at.desc"));

// A log submission, then removed again so the database is left as seeded.
const todays = calendar.find((e) => e.source === "facility" && e.title === "Squat Day" && !e.log_id);
if (todays) {
  const [workout] = await get(`workouts?select=${workoutSelect}&id=eq.${todays.workout_id}`);
  const squat = workout.workout_items.find((i) => i.title === "Back Squat");
  const result = await rpc("submit_workout_log", {
    p_workout: workout.id,
    p_performed_on: todays.calendar_date,
    p_entries: [{ workout_item_id: squat.id, set_index: 1, load: 250, load_unit: "lb", reps: 5, rpe: 8.5 }],
    p_notes: "Fixture",
  });
  save("log_result", result);
  await fetch(`${base}/rest/v1/workout_logs?id=eq.${result.log_id}`, { method: "DELETE", headers });
}
console.log(`Fixtures written to ${out}`);
