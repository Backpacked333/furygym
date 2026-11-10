"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { METRICS, METRIC_LABELS, type Metric, type WorkoutInput, type WorkoutItemInput } from "@/lib/workouts";
import { saveWorkout } from "../../actions";

type Exercise = { id: string; name: string; default_metrics: Metric[]; video_url: string | null };
type Track = { id: string; name: string; kind: string };
type Item = WorkoutItemInput & { key: string };

let keySeed = 0;
const newKey = () => `item-${keySeed++}`;

export function WorkoutEditor({ initial, tracks, exercises, programLabel, defaultPublishTime }: {
  initial: WorkoutInput;
  tracks: Track[];
  exercises: Exercise[];
  programLabel: string | null;
  defaultPublishTime: string;
}) {
  const [workout, setWorkout] = useState(initial);
  const [items, setItems] = useState<Item[]>(() => initial.items.map((i) => ({ ...i, key: newKey() })));

  const set = <K extends keyof WorkoutInput>(key: K, value: WorkoutInput[K]) => setWorkout((w) => ({ ...w, [key]: value }));
  const setItem = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const addItem = () => setItems((list) => [...list, { key: newKey(), title: "", metrics: [], section: list.at(-1)?.section ?? null }]);

  const pickExercise = (item: Item, exerciseId: string) => {
    const exercise = exercises.find((e) => e.id === exerciseId);
    setItem(item.key, {
      exercise_id: exerciseId || null,
      // Fill in what the library knows, without overwriting anything the coach already typed.
      title: item.title || exercise?.name || "",
      metrics: item.metrics.length ? item.metrics : (exercise?.default_metrics ?? []),
      video_url: item.video_url || exercise?.video_url || null,
    });
  };
  const toggleMetric = (item: Item, metric: Metric) =>
    setItem(item.key, { metrics: item.metrics.includes(metric) ? item.metrics.filter((m) => m !== metric) : [...item.metrics, metric] });

  // "key" is only for React; it is not part of the saved workout.
  const payload = JSON.stringify({ ...workout, items: items.map((item) => ({ ...item, key: undefined })) });
  const isProgram = Boolean(workout.program_id);

  return (
    <ActionForm action={saveWorkout} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      <Card title="Workout">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title" className="md:col-span-2">
            <Input value={workout.title} onChange={(e) => set("title", e.target.value)} placeholder="Squat Day" required />
          </Field>
          <Field label="Track">
            <Select value={workout.track_id ?? ""} onChange={(e) => set("track_id", e.target.value || null)}>
              <option value="">No track</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          {isProgram ? (
            <Field label="Placement">
              <Input value={programLabel ?? ""} disabled />
            </Field>
          ) : workout.is_template ? (
            <Field label="Placement">
              <Input value="Template — not on the calendar" disabled />
            </Field>
          ) : (
            <Field label="Date">
              <Input type="date" value={workout.scheduled_date ?? ""} onChange={(e) => set("scheduled_date", e.target.value)} required />
            </Field>
          )}
          <Field label="Overview" hint="Shown to athletes at the top of the workout." className="md:col-span-2">
            <Textarea value={workout.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Coach notes" hint="Shown to athletes under the overview; optional on the gym display." className="md:col-span-2">
            <Textarea value={workout.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Items" actions={<Button type="button" small onClick={addItem}>+ Add item</Button>}>
        {items.length === 0 ? <p className="text-sm text-muted">Add the movements or pieces that make up this workout.</p> : null}
        <ol className="space-y-4">
          {items.map((item, index) => (
            <li key={item.key} className="rounded-lg border border-line bg-bg p-3" data-testid="workout-item">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted">Item {index + 1}</span>
                <span className="flex gap-1">
                  <Button type="button" small variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">↑</Button>
                  <Button type="button" small variant="ghost" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down">↓</Button>
                  <Button type="button" small variant="danger" onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>Remove</Button>
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-6">
                <Field label="Section" className="md:col-span-1">
                  <Input value={item.section ?? ""} onChange={(e) => setItem(item.key, { section: e.target.value })} placeholder="Strength" />
                </Field>
                <Field label="Exercise (library)" className="md:col-span-2">
                  <Select value={item.exercise_id ?? ""} onChange={(e) => pickExercise(item, e.target.value)}>
                    <option value="">Custom / none</option>
                    {exercises.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Title" className="md:col-span-3">
                  <Input value={item.title} onChange={(e) => setItem(item.key, { title: e.target.value })} placeholder="Back Squat" required />
                </Field>
                <Field label="Prescription" className="md:col-span-3">
                  <Textarea value={item.prescription ?? ""} onChange={(e) => setItem(item.key, { prescription: e.target.value })} placeholder="5 x 5 @ 75-80%" />
                </Field>
                <Field label="Scaling" className="md:col-span-3">
                  <Textarea value={item.scaling ?? ""} onChange={(e) => setItem(item.key, { scaling: e.target.value })} placeholder="How to adjust for newer athletes" />
                </Field>
                <Field label="Movement notes" className="md:col-span-3">
                  <Input value={item.notes ?? ""} onChange={(e) => setItem(item.key, { notes: e.target.value })} />
                </Field>
                <Field label="Instruction video URL" className="md:col-span-3">
                  <Input type="url" value={item.video_url ?? ""} onChange={(e) => setItem(item.key, { video_url: e.target.value })} placeholder="https://youtu.be/…" />
                </Field>
              </div>
              <fieldset className="mt-3">
                <legend className="mb-1 text-xs font-medium text-muted">Athletes record</legend>
                <div className="flex flex-wrap gap-1.5">
                  {METRICS.map((metric) => {
                    const on = item.metrics.includes(metric);
                    return (
                      <button
                        key={metric}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleMetric(item, metric)}
                        className={cx("rounded-full border px-2.5 py-1 text-xs", on ? "border-accent bg-accent/15 text-ink" : "border-line text-muted hover:border-muted")}
                      >
                        {METRIC_LABELS[metric]}
                      </button>
                    );
                  })}
                </div>
                {item.metrics.includes("benchmark") ? (
                  <Field label="Benchmark name" hint="Results are tracked under this name every time it is programmed." className="mt-3 max-w-sm">
                    <Input value={item.benchmark_name ?? ""} onChange={(e) => setItem(item.key, { benchmark_name: e.target.value })} placeholder={item.title || "2k Row"} />
                  </Field>
                ) : null}
              </fieldset>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Publishing">
        {workout.is_template ? (
          <p className="text-sm text-muted">Templates are never shown to athletes. Use one to start a dated workout.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="publish" checked={workout.publish === "draft"} onChange={() => set("publish", "draft")} className="mt-1" />
              <span><span className="font-medium">Draft</span><span className="block text-muted">Only staff can see it.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="publish" checked={workout.publish === "now"} onChange={() => set("publish", "now")} className="mt-1" />
              <span><span className="font-medium">Publish now</span><span className="block text-muted">Visible in the app{isProgram ? " to enrolled athletes as their calendar unlocks it" : " and on the gym display straight away"}.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="publish" checked={workout.publish === "schedule"} onChange={() => { set("publish", "schedule"); if (!workout.publish_time) set("publish_time", defaultPublishTime); }} className="mt-1" />
              <span><span className="font-medium">Schedule</span><span className="block text-muted">Stays hidden until the time you choose (gym time).</span></span>
            </label>
            {workout.publish === "schedule" ? (
              <div className="ml-6 flex flex-wrap gap-3">
                <Field label="Publish date"><Input type="date" value={workout.publish_date ?? ""} onChange={(e) => set("publish_date", e.target.value)} required /></Field>
                <Field label="Publish time"><Input type="time" value={workout.publish_time ?? ""} onChange={(e) => set("publish_time", e.target.value)} required /></Field>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton>Save workout</SubmitButton>
      </div>
    </ActionForm>
  );
}
