import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Badge, Card, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { addDays, formatDate, formatDateTime, todayInZone } from "@/lib/format";
import type { DisplayPayload } from "@/lib/display";
import { createPublicClient } from "@/lib/supabase/server";
import { rotateDisplayToken, saveDisplay } from "./actions";

export const metadata = { title: "Displays" };

function Toggle({ name, label, hint, on }: { name: string; label: string; hint: string; on?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <span><span className="block">{label}</span><span className="text-[13px] text-muted">{hint}</span></span>
      <input type="checkbox" name={name} defaultChecked={on} className="peer sr-only" />
      <span className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-fill transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-[27px] after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-accent-fill peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
    </label>
  );
}

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
  const preview = secret ? ((await createPublicClient().rpc("get_display", { p_token: secret.display_token })).data as unknown as DisplayPayload | null) : null;
  const showing = preview?.workouts[0];

  return (
    <>
      <PageHeader eyebrow="Facility" title="Displays" description="What the gym screens show. Open the display link in a browser on each TV and leave it running." />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-[26px] bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--color-accent)]">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-raised"><Icon name="display" size={22} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Gym display</p>
              <p className="truncate text-[13px] text-muted">
                {state?.mode === "off" ? "Blank screen" : state?.mode === "manual" ? "Pinned workout" : `Following the schedule${preview?.next_class ? ` · ${preview.next_class.title}` : ""}`}
              </p>
            </div>
            <Badge tone={state?.mode === "off" ? "neutral" : "good"} dot>{state?.mode === "off" ? "Blank" : "On"}</Badge>
          </div>

          <Card title="Display link">
            {path ? (
              <>
                <p className="break-all rounded-2xl bg-raised px-3.5 py-2.5 font-mono text-xs" data-testid="display-url">{env.siteUrl}{path}</p>
                <p className="mt-2 text-[13px] text-muted">Anyone with this link can see the display, so share it only with gym devices. It needs no login.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LinkButton href={path} target="_blank" variant="tinted"><Icon name="external" size={18} />Open full preview</LinkButton>
                  {isAdmin ? (
                    <ActionButton action={rotateDisplayToken} fields={{}} variant="danger" small={false} confirm="Create a new link? Screens using the current link will stop working until updated.">Replace link</ActionButton>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No display link is configured.</p>
            )}
          </Card>
        </div>

        <Card title="Gym display">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl bg-black p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex items-center justify-between text-[11px]"><span className="brand">Fury Co.</span><span className="font-semibold">{preview?.next_class ? formatDateTime(preview.next_class.starts_at, gym.timezone).split(", ").pop() : ""}</span></div>
              {preview?.message ? <p className="mt-2 rounded-lg bg-accent/15 px-2 py-1 text-xs font-semibold">{preview.message}</p> : null}
              {showing ? (
                <>
                  <p className="brand mt-2 text-xl">{showing.track ?? "Workout"} <span className="text-xs font-semibold not-italic text-muted normal-case">· {showing.title}</span></p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {showing.items.slice(0, 3).map((item, i) => (
                      <div key={item.id} className="rounded-xl bg-surface p-2.5">
                        <p className="text-sm font-extrabold text-accent">{String.fromCharCode(65 + i)}</p>
                        <p className="text-xs font-semibold leading-tight">{item.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{item.prescription}</p>
                      </div>
                    ))}
                  </div>
                  {preview && preview.workouts.length > 1 ? <p className="mt-2 text-[11px] text-muted">+{preview.workouts.length - 1} more on screen</p> : null}
                </>
              ) : (
                <p className="py-8 text-center text-xs text-muted">{state?.mode === "off" ? "Screen is blank" : "No published workout to show right now"}</p>
              )}
            </div>

            <ActionForm action={saveDisplay}>
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold text-muted">Mode</legend>
                <div className="grid grid-cols-3 gap-1 rounded-full bg-fill p-0.5 text-center text-[13px] font-semibold">
                  {[["auto", "Today’s workout"], ["manual", "Pinned"], ["off", "Off"]].map(([value, label]) => (
                    <label key={value} className="cursor-pointer rounded-full px-2 py-1.5 has-[:checked]:bg-white/20">
                      <input type="radio" name="mode" value={value} defaultChecked={state?.mode === value} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-3">
                <Toggle name="show_checked_in" label="Show checked-in athletes" hint="First name and last initial, for the current class" on={state?.show_checked_in} />
                <Toggle name="show_coach_notes" label="Show coach notes on screen" hint="Under each workout" on={state?.show_coach_notes} />
              </div>
              <div className="mt-3 space-y-3">
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
              </div>
              <div className="mt-4"><SubmitButton>Update display</SubmitButton></div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
