import { notFound } from "next/navigation";
import { ActionButton } from "@/components/forms";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addDays, dateInZone, timeInputValue } from "@/lib/format";
import { publishState, type Metric, type WorkoutInput } from "@/lib/workouts";
import { deleteWorkout } from "../../actions";
import { WorkoutEditor } from "./editor";

export const metadata = { title: "Workout" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function WorkoutPage({ params, searchParams }: PageProps<"/admin/programming/workouts/[id]">) {
  const { supabase, gym } = await requireStaff();
  const { id } = await params;
  const query = await searchParams;

  const [{ data: tracks }, { data: exercises }] = await Promise.all([
    supabase.from("tracks").select("id, name, kind").eq("active", true).order("position"),
    supabase.from("exercises").select("id, name, category, default_metrics, video_url").eq("archived", false).order("name"),
  ]);

  let initial: WorkoutInput;
  let programLabel: string | null = null;
  let back = "/admin/programming";

  const sourceId = id === "new" ? one(query.from) : id;
  if (sourceId) {
    const { data: workout } = await supabase
      .from("workouts")
      .select("*, workout_items(*), program_workouts(program_id, week, day, programs(name))")
      .eq("id", sourceId)
      .maybeSingle();
    if (!workout) notFound();

    const copying = id === "new";
    const placement = workout.program_workouts[0];
    const state = publishState(workout);
    initial = {
      id: copying ? null : workout.id,
      title: workout.title,
      track_id: workout.track_id,
      scheduled_date: copying ? (one(query.date) ?? null) : workout.scheduled_date,
      description: workout.description,
      coach_notes: workout.coach_notes,
      is_template: copying ? false : workout.is_template,
      publish: copying || state === "draft" ? "draft" : state === "live" ? "now" : "schedule",
      publish_date: !copying && workout.publish_at ? dateInZone(new Date(workout.publish_at), gym.timezone) : null,
      publish_time: !copying && workout.publish_at ? timeInputValue(workout.publish_at, gym.timezone) : null,
      program_id: copying ? null : (placement?.program_id ?? null),
      week: copying ? null : (placement?.week ?? null),
      day: copying ? null : (placement?.day ?? null),
      items: [...workout.workout_items]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          id: copying ? null : item.id,
          section: item.section,
          title: item.title,
          exercise_id: item.exercise_id,
          prescription: item.prescription,
          scaling: item.scaling,
          notes: item.notes,
          video_url: item.video_url,
          metrics: item.metrics as Metric[],
          benchmark_name: item.benchmark_name,
        })),
    };
    if (!copying && placement) {
      programLabel = `${placement.programs?.name ?? "Program"} — week ${placement.week}, day ${placement.day}`;
      back = `/admin/programs/${placement.program_id}`;
    }
  } else {
    const programId = one(query.program) ?? null;
    const week = Number(one(query.week)) || null;
    const day = Number(one(query.day)) || null;
    let trackId = one(query.track) ?? null;
    if (programId) {
      const { data: program } = await supabase.from("programs").select("name, track_id").eq("id", programId).maybeSingle();
      if (!program) notFound();
      programLabel = `${program.name} — week ${week}, day ${day}`;
      trackId = trackId ?? program.track_id;
      back = `/admin/programs/${programId}`;
    }
    const date = one(query.date) ?? null;
    initial = {
      id: null,
      title: "",
      track_id: trackId,
      scheduled_date: date,
      description: null,
      coach_notes: null,
      is_template: one(query.template) === "1",
      publish: "draft",
      // Default schedule: 6pm the evening before, so athletes can plan ahead.
      publish_date: date ? addDays(date, -1) : null,
      publish_time: null,
      program_id: programId,
      week,
      day,
      items: [],
    };
  }

  return (
    <>
      <PageHeader
        eyebrow={programLabel ?? (initial.is_template ? "Programming · Template" : `Programming${initial.scheduled_date ? ` · ${initial.scheduled_date}` : ""}`)}
        title={initial.title || (initial.is_template ? "New template" : "New workout")}
        actions={
          <>
            <LinkButton href={back}>Back</LinkButton>
            {initial.id ? (
              <ActionButton action={deleteWorkout} fields={{ id: initial.id, back }} variant="danger" small={false} confirm="Delete this workout? This cannot be undone.">
                Delete
              </ActionButton>
            ) : null}
          </>
        }
      />
      <WorkoutEditor
        initial={initial}
        tracks={tracks ?? []}
        exercises={(exercises ?? []) as { id: string; name: string; category: string | null; default_metrics: Metric[]; video_url: string | null }[]}
        programLabel={programLabel}
        defaultPublishTime="18:00"
      />
    </>
  );
}
