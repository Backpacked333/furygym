import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { METRICS, METRIC_LABELS, type Metric } from "@/lib/workouts";
import { saveExercise } from "../programming/actions";

export const metadata = { title: "Exercises" };

function ExerciseFields({ exercise }: { exercise?: { id: string; name: string; category: string | null; cues: string | null; video_url: string | null; default_metrics: Metric[]; archived: boolean } }) {
  return (
    <>
      {exercise ? <input type="hidden" name="id" value={exercise.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name"><Input name="name" defaultValue={exercise?.name} required /></Field>
        <Field label="Category"><Input name="category" defaultValue={exercise?.category ?? ""} placeholder="Strength, Conditioning…" /></Field>
        <Field label="Coaching cues" className="md:col-span-2"><Textarea name="cues" defaultValue={exercise?.cues ?? ""} /></Field>
        <Field label="Instruction video URL" className="md:col-span-2"><Input name="video_url" type="url" defaultValue={exercise?.video_url ?? ""} placeholder="https://youtu.be/…" /></Field>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-xs font-medium text-muted">Recorded by default</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {METRICS.filter((m) => m !== "benchmark").map((metric) => (
            <label key={metric} className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="default_metrics" value={metric} defaultChecked={exercise?.default_metrics.includes(metric)} />
              {METRIC_LABELS[metric]}
            </label>
          ))}
        </div>
      </fieldset>
      {exercise ? (
        <label className="mt-3 inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="archived" defaultChecked={exercise.archived} /> Archived (hidden from the workout builder)
        </label>
      ) : null}
    </>
  );
}

export default async function ExercisesPage() {
  const { supabase } = await requireStaff();
  const { data: exercises } = await supabase.from("exercises").select("*").order("archived").order("name");

  return (
    <>
      <PageHeader title="Exercise library" description="Movements with cues, instruction video and the fields athletes record by default. Pick them in the workout builder." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title={`${exercises?.length ?? 0} exercises`}>
          {exercises?.length ? (
            <ul className="divide-y divide-line">
              {exercises.map((e) => (
                <li key={e.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{e.name} <span className="font-normal text-muted">{e.category}</span></span>
                      <span className="flex flex-wrap gap-1">
                        {e.archived ? <Badge tone="warn">Archived</Badge> : null}
                        {e.video_url ? <Badge>Video</Badge> : null}
                        {(e.default_metrics as Metric[]).map((m) => <Badge key={m}>{METRIC_LABELS[m]}</Badge>)}
                      </span>
                    </summary>
                    <ActionForm action={saveExercise} className="mt-3 rounded-lg border border-line bg-bg p-3">
                      <ExerciseFields exercise={{ ...e, default_metrics: e.default_metrics as Metric[] }} />
                      <div className="mt-3"><SubmitButton small>Save</SubmitButton></div>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No exercises yet.</Empty>
          )}
        </Card>
        <Card title="Add exercise">
          <ActionForm action={saveExercise}>
            <ExerciseFields />
            <div className="mt-4"><SubmitButton>Add exercise</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
