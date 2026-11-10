import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Empty, Field, Input, PageHeader, Select, StatusBadge, Table, Td, TrackDot } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { money } from "@/lib/format";
import { saveProgram } from "./actions";

export const metadata = { title: "Online programs" };

export default async function ProgramsPage() {
  const { supabase } = await requireStaff();
  const [{ data: programs }, { data: tracks }, { data: enrollments }] = await Promise.all([
    supabase.from("programs").select("*, tracks(name, color), program_workouts(id)").order("position").order("name"),
    supabase.from("tracks").select("id, name").eq("active", true).order("position"),
    supabase.from("enrollments").select("program_id").eq("status", "active"),
  ]);
  const enrolled = (id: string) => (enrollments ?? []).filter((e) => e.program_id === id).length;

  return (
    <>
      <PageHeader eyebrow="Coaching" title="Online programs" description="Time-bound programs athletes buy and start on their own date. Each athlete's calendar is built from their start date." />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title="Programs">
          {programs?.length ? (
            <Table head={["Program", "Length", "Workouts", "Price", "Active athletes", "Status"]}>
              {programs.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/admin/programs/${p.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                      <TrackDot color={p.tracks?.color} />{p.name}
                    </Link>
                  </Td>
                  <Td>{p.duration_weeks} wk × {p.days_per_week}/wk</Td>
                  <Td className="tabular-nums">{p.program_workouts.length}/{p.duration_weeks * p.days_per_week}</Td>
                  <Td className="tabular-nums">{money(p.price_cents, p.currency)}</Td>
                  <Td className="tabular-nums">{enrolled(p.id)}</Td>
                  <Td><StatusBadge status={p.status} /></Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No programs yet.</Empty>
          )}
        </Card>
        <Card title="New program">
          <ActionForm action={saveProgram} className="space-y-3">
            <Field label="Name"><Input name="name" placeholder="Engine Builder — 8 Week" required /></Field>
            <Field label="Track">
              <Select name="track_id" defaultValue="">
                <option value="">No track</option>
                {(tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weeks"><Input name="duration_weeks" type="number" min={1} max={104} defaultValue={8} required /></Field>
              <Field label="Days / week"><Input name="days_per_week" type="number" min={1} max={7} defaultValue={5} required /></Field>
            </div>
            <Field label="Price (USD)"><Input name="price" inputMode="decimal" defaultValue="149" required /></Field>
            <SubmitButton>Create program</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
