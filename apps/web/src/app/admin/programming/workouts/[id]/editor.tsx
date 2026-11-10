"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Badge, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { METRICS, METRIC_LABELS, type Metric, type WorkoutInput, type WorkoutItemInput } from "@/lib/workouts";
import { saveWorkout } from "../../actions";

type Exercise = { id: string; name: string; category: string | null; default_metrics: Metric[]; video_url: string | null };
type Track = { id: string; name: string; kind: string };
type Item = WorkoutItemInput & { key: string };

let keySeed = 0;
const newKey = () => `item-${keySeed++}`;
const LETTER_COLORS = ["#ff4245", "#ff4245", "#ff9230", "#6d7cff", "#30d158", "#ffd600"];
const METRIC_HINTS: Partial<Record<Metric, string>> = { load: "per set", sets: "count", rpe: "1–10", splits: "per interval", benchmark: "tracked over time" };

function Switch({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5">
      <span><span className="block text-[15px]">{label}</span>{hint ? <span className="text-xs text-muted">{hint}</span> : null}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onChange}
        className={cx("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", on ? "bg-accent-fill" : "bg-fill")}
      >
        <span className={cx("absolute top-0.5 size-[27px] rounded-full bg-white shadow transition-[left]", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}

/** The workout builder: exercise library, lettered blocks, and the logging inspector for the selected block. */
export function WorkoutEditor({ initial, tracks, exercises, programLabel, defaultPublishTime }: {
  initial: WorkoutInput;
  tracks: Track[];
  exercises: Exercise[];
  programLabel: string | null;
  defaultPublishTime: string;
}) {
  const [workout, setWorkout] = useState(initial);
  const [items, setItems] = useState<Item[]>(() => initial.items.map((i) => ({ ...i, key: newKey() })));
  const [selectedKey, setSelectedKey] = useState<string | null>(() => null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null;
  const selectedIndex = selected ? items.findIndex((i) => i.key === selected.key) : -1;

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
  const addItem = (from?: Exercise) => {
    const key = newKey();
    setItems((list) => [
      ...list,
      { key, title: from?.name ?? "", exercise_id: from?.id ?? null, metrics: from?.default_metrics ?? [], video_url: from?.video_url ?? null, section: from?.category ?? list.at(-1)?.section ?? null },
    ]);
    setSelectedKey(key);
  };
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
  const categories = ["All", ...Array.from(new Set(exercises.map((e) => e.category).filter((c): c is string => Boolean(c))))];
  const library = exercises.filter((e) => (category === "All" || e.category === category) && e.name.toLowerCase().includes(search.trim().toLowerCase()));
  const loggingFields = items.reduce((n, i) => n + i.metrics.length, 0);

  return (
    <ActionForm action={saveWorkout}>
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 xl:grid-cols-[270px_minmax(0,1fr)_320px]">
        {/* Exercise library */}
        <aside className="rounded-[26px] bg-surface p-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
          <h2 className="px-1 text-[17px] font-semibold">Exercise library</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${exercises.length} movements…`} aria-label="Search exercises" className="mt-3 w-full rounded-2xl bg-raised px-4 py-2.5 text-[15px] outline-none placeholder:text-faint focus:shadow-[0_0_0_2px_var(--color-accent)]" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} className={cx("h-7 rounded-full px-3 text-xs font-semibold", category === c ? "bg-white/20 text-white" : "bg-fill text-white/85")}>{c}</button>
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {library.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => addItem(e)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-fill-soft" title="Add as a block">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-white/80"><Icon name="plus" size={16} /></span>
                  <span className="min-w-0"><span className="block truncate text-[15px] font-semibold leading-tight">{e.name}</span><span className="text-xs text-muted">{e.category ?? "Movement"}{e.video_url ? " · video" : ""}</span></span>
                </button>
              </li>
            ))}
            {library.length === 0 ? <li className="px-2 py-3 text-sm text-muted">No movements match.</li> : null}
          </ul>
        </aside>

        {/* Workout and blocks */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-[26px] bg-surface p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title" className="md:col-span-2">
                <Input value={workout.title} onChange={(e) => set("title", e.target.value)} placeholder="Deadlift Complex" required />
              </Field>
              <Field label="Track">
                <Select value={workout.track_id ?? ""} onChange={(e) => set("track_id", e.target.value || null)}>
                  <option value="">No track</option>
                  {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              {isProgram ? (
                <Field label="Placement"><Input value={programLabel ?? ""} disabled /></Field>
              ) : workout.is_template ? (
                <Field label="Placement"><Input value="Template — not on the calendar" disabled /></Field>
              ) : (
                <Field label="Date"><Input type="date" value={workout.scheduled_date ?? ""} onChange={(e) => set("scheduled_date", e.target.value)} required /></Field>
              )}
              <Field label="Overview" hint="Shown to athletes at the top of the workout." className="md:col-span-2">
                <Textarea value={workout.description ?? ""} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <Field label="Coach notes" hint="Shown to athletes under the overview; optional on the gym display." className="md:col-span-2">
                <Textarea value={workout.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} />
              </Field>
            </div>
          </section>

          {items.map((item, index) => {
            const isSelected = selected?.key === item.key;
            const color = LETTER_COLORS[index % LETTER_COLORS.length];
            return (
              <section
                key={item.key}
                data-testid="workout-item"
                onFocusCapture={() => setSelectedKey(item.key)}
                onClick={() => setSelectedKey(item.key)}
                className={cx("rounded-[26px] bg-surface p-5", isSelected && "shadow-[inset_0_0_0_1.5px_var(--color-accent)]")}
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold" style={{ color, background: `color-mix(in srgb, ${color} 20%, transparent)` }}>{String.fromCharCode(65 + index)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-semibold leading-tight">{item.title || "New block"}</p>
                    <p className="flex flex-wrap gap-1 pt-1">
                      {item.metrics.length ? item.metrics.map((m) => <Badge key={m}>{METRIC_LABELS[m]}</Badge>) : <span className="text-xs text-warn">No logging fields yet</span>}
                    </p>
                  </div>
                  <span className="flex gap-1">
                    <Button type="button" small variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">↑</Button>
                    <Button type="button" small variant="ghost" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down">↓</Button>
                    <Button type="button" small variant="danger" onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>Remove</Button>
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-6">
                  <Field label="Section" className="md:col-span-2">
                    <Input value={item.section ?? ""} onChange={(e) => setItem(item.key, { section: e.target.value })} placeholder="Strength" />
                  </Field>
                  <Field label="Exercise (library)" className="md:col-span-2">
                    <Select value={item.exercise_id ?? ""} onChange={(e) => pickExercise(item, e.target.value)}>
                      <option value="">Custom / none</option>
                      {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Title" className="md:col-span-2">
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
              </section>
            );
          })}

          <button type="button" onClick={() => addItem()} className="flex h-12 w-full items-center justify-center gap-2 rounded-[26px] font-semibold text-accent shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface">
            <Icon name="plus" size={18} />Add block
          </button>
        </div>

        {/* Inspector: logging for the selected block, then publishing */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-[26px] bg-surface p-5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[17px] font-semibold">Logging{selected ? ` · Block ${String.fromCharCode(65 + selectedIndex)}` : ""}</h2>
              {selected ? <Badge tone="accent">Selected</Badge> : null}
            </div>
            {selected ? (
              <>
                <p className="mb-1 text-[13px] text-muted">What athletes record for {selected.title || "this block"}.</p>
                {METRICS.filter((m) => m !== "benchmark").map((metric) => (
                  <Switch key={metric} label={METRIC_LABELS[metric]} hint={METRIC_HINTS[metric]} on={selected.metrics.includes(metric)} onChange={() => toggleMetric(selected, metric)} />
                ))}
                <Switch label="Feeds a benchmark" hint={METRIC_HINTS.benchmark} on={selected.metrics.includes("benchmark")} onChange={() => toggleMetric(selected, "benchmark")} />
                {selected.metrics.includes("benchmark") ? (
                  <Field label="Benchmark name" hint="Results are tracked under this name every time it is programmed." className="mt-3">
                    <Input value={selected.benchmark_name ?? ""} onChange={(e) => setItem(selected.key, { benchmark_name: e.target.value })} placeholder={selected.title || "2k Row"} />
                  </Field>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted">Add a block from the library, then choose what athletes record.</p>
            )}
          </section>

          <section className="rounded-[26px] bg-surface p-5">
            <h2 className="mb-3 text-[17px] font-semibold">Publishing</h2>
            {workout.is_template ? (
              <p className="text-sm text-muted">Templates are never shown to athletes. Use one to start a dated workout.</p>
            ) : (
              <div className="space-y-3 text-[15px]">
                <label className="flex items-start gap-2.5">
                  <input type="radio" name="publish" checked={workout.publish === "draft"} onChange={() => set("publish", "draft")} className="mt-1 accent-[var(--color-accent)]" />
                  <span><span className="font-semibold">Draft</span><span className="block text-[13px] text-muted">Only staff can see it.</span></span>
                </label>
                <label className="flex items-start gap-2.5">
                  <input type="radio" name="publish" checked={workout.publish === "now"} onChange={() => set("publish", "now")} className="mt-1 accent-[var(--color-accent)]" />
                  <span><span className="font-semibold">Publish now</span><span className="block text-[13px] text-muted">Visible in the app{isProgram ? " to enrolled athletes as their calendar unlocks it" : " and on the gym display straight away"}.</span></span>
                </label>
                <label className="flex items-start gap-2.5">
                  <input type="radio" name="publish" checked={workout.publish === "schedule"} onChange={() => { set("publish", "schedule"); if (!workout.publish_time) set("publish_time", defaultPublishTime); }} className="mt-1 accent-[var(--color-accent)]" />
                  <span><span className="font-semibold">Schedule</span><span className="block text-[13px] text-muted">Stays hidden until the time you choose (gym time).</span></span>
                </label>
                {workout.publish === "schedule" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Publish date"><Input type="date" value={workout.publish_date ?? ""} onChange={(e) => set("publish_date", e.target.value)} required /></Field>
                    <Field label="Publish time"><Input type="time" value={workout.publish_time ?? ""} onChange={(e) => set("publish_time", e.target.value)} required /></Field>
                  </div>
                ) : null}
              </div>
            )}
            <p className="mt-4 text-[13px] text-muted">{items.length} {items.length === 1 ? "block" : "blocks"} · {loggingFields} logging {loggingFields === 1 ? "field" : "fields"}</p>
            <div className="mt-3"><SubmitButton className="w-full">Save workout</SubmitButton></div>
          </section>
        </aside>
      </div>
    </ActionForm>
  );
}
