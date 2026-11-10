import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { addDays, formatDate, todayInZone } from "@/lib/format";
import { rotateDisplayToken, saveDisplay } from "./actions";

export const metadata = { title: "TV display" };

export default async function DisplayControlPage() {
  const { supabase, gym, isAdmin } = await requireStaff();
  const today = todayInZone(gym.timezone);
  const [{ data: state }, { data: secret }, { data: tracks }, { data: workouts }] = await Promise.all([
    supabase.from("display_state").select("*").eq("gym_id", gym.id).single(),
    supabase.from("gym_secrets").select("display_token").eq("gym_id", gym.id).single(),
    supabase.from("tracks").select("id, name").eq("kind", "facility").eq("active", true).order("position"),
    supabase
      .from("workouts")
      .select("id, title, scheduled_date, tracks(name)")
      .eq("status", "published")
      .lte("publish_at", new Date().toISOString())
      .gte("scheduled_date", addDays(today, -7))
      .lte("scheduled_date", addDays(today, 7))
      .order("scheduled_date", { ascending: false }),
  ]);
  const path = secret ? `/display/${secret.display_token}` : null;

  return (
    <>
      <PageHeader title="TV display" description="What the gym screens show. Open the display link in a browser on each TV or kiosk and leave it running." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What's on screen">
          <ActionForm action={saveDisplay} className="space-y-4">
            <fieldset className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" name="mode" value="auto" defaultChecked={state?.mode === "auto"} className="mt-1" />
                <span><span className="font-medium">Today&apos;s workout</span><span className="block text-muted">Follows the programming calendar automatically.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="mode" value="manual" defaultChecked={state?.mode === "manual"} className="mt-1" />
                <span><span className="font-medium">Pinned</span><span className="block text-muted">Show one chosen workout, or only the message below.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="mode" value="off" defaultChecked={state?.mode === "off"} className="mt-1" />
                <span><span className="font-medium">Off</span><span className="block text-muted">Hide workouts. The message still shows if set.</span></span>
              </label>
            </fieldset>
            <Field label="Track (today's workout mode)">
              <Select name="track_id" defaultValue={state?.track_id ?? ""}>
                <option value="">All facility tracks</option>
                {(tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} only</option>)}
              </Select>
            </Field>
            <Field label="Pinned workout (pinned mode)" hint="Only published workouts can be shown.">
              <Select name="workout_id" defaultValue={state?.workout_id ?? ""}>
                <option value="">None</option>
                {(workouts ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.scheduled_date ? formatDate(w.scheduled_date) : ""} — {w.tracks?.name}: {w.title}</option>
                ))}
              </Select>
            </Field>
            <Field label="Message banner" hint="Optional. For example: “Open gym until 8pm”.">
              <Input name="message" defaultValue={state?.message ?? ""} maxLength={140} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="show_coach_notes" defaultChecked={state?.show_coach_notes} /> Show coach notes on screen
            </label>
            <SubmitButton>Update display</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Display link">
          {path ? (
            <>
              <p className="break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs" data-testid="display-url">{env.siteUrl}{path}</p>
              <p className="mt-2 text-xs text-muted">Anyone with this link can see the display, so share it only with gym devices. It needs no login.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <LinkButton href={path} target="_blank">Open display</LinkButton>
                {isAdmin ? (
                  <ActionButton action={rotateDisplayToken} fields={{}} variant="danger" small={false} confirm="Create a new link? Screens using the current link will stop working until updated.">
                    Replace link
                  </ActionButton>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No display link is configured.</p>
          )}
        </Card>
      </div>
    </>
  );
}
