import { z } from "zod";

export const METRICS = ["load", "sets", "reps", "time", "distance", "pace", "splits", "rpe", "benchmark", "comments"] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  load: "Load", sets: "Sets", reps: "Reps", time: "Time", distance: "Distance", pace: "Pace",
  splits: "Splits", rpe: "RPE", benchmark: "Benchmark result", comments: "Comments",
};

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const nullableText = z.preprocess(blank, z.string().trim().nullable().optional());
const nullableUuid = z.preprocess(blank, z.string().uuid().nullable().optional());

export const workoutItemSchema = z.object({
  id: nullableUuid,
  section: nullableText,
  title: z.string().trim().min(1, "Every item needs a title."),
  exercise_id: nullableUuid,
  prescription: nullableText,
  scaling: nullableText,
  notes: nullableText,
  video_url: z.preprocess(blank, z.string().url("Video links must be full URLs.").nullable().optional()),
  metrics: z.array(z.enum(METRICS)).default([]),
  benchmark_name: nullableText,
});

export const workoutSchema = z.object({
  id: nullableUuid,
  title: z.string().trim().min(1, "Give the workout a title."),
  track_id: nullableUuid,
  scheduled_date: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  description: nullableText,
  coach_notes: nullableText,
  is_template: z.boolean().default(false),
  publish: z.enum(["draft", "now", "schedule"]),
  publish_date: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  publish_time: z.preprocess(blank, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()),
  program_id: nullableUuid,
  week: z.number().int().min(1).nullable().optional(),
  day: z.number().int().min(1).max(7).nullable().optional(),
  items: z.array(workoutItemSchema),
});

export type WorkoutInput = z.infer<typeof workoutSchema>;
export type WorkoutItemInput = z.infer<typeof workoutItemSchema>;

/** Draft, Scheduled (published but not yet visible) or Live. */
export function publishState(workout: { status: string; publish_at: string | null }, now = new Date()): "draft" | "scheduled" | "live" {
  if (workout.status !== "published" || !workout.publish_at) return "draft";
  return new Date(workout.publish_at) <= now ? "live" : "scheduled";
}
