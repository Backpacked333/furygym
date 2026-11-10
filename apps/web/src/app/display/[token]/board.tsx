"use client";

import { useEffect, useState } from "react";
import type { DisplayPayload, DisplayWorkout } from "@/lib/display";

const REFRESH_MS = 30_000;
const BLOCK_COLORS = ["#ff4245", "#ff4245", "#ff9230", "#6d7cff", "#30d158", "#ffd600"];

function countdown(target: string, now: number): { label: string; value: string } {
  const diff = Math.round((new Date(target).getTime() - now) / 1000);
  if (diff <= 0) return { label: "Class", value: "In progress" };
  const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
  return { label: "Starts in", value: h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}` };
}

function Blocks({ workout, compact }: { workout: DisplayWorkout; compact: boolean }) {
  const scale = compact ? 0.72 : 1;
  const vw = (n: number) => `${(n * scale).toFixed(2)}vw`;
  return (
    <div className="grid flex-1 gap-[1.4vw]" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(workout.items.length, 1), 4)}, minmax(0, 1fr))` }}>
      {workout.items.map((item, index) => {
        const color = BLOCK_COLORS[index % BLOCK_COLORS.length];
        return (
          <section key={item.id} className="rounded-[1.6vw] bg-[#141416]" style={{ padding: vw(1.8) }}>
            <div className="flex items-center" style={{ gap: vw(1.1) }}>
              <span className="flex shrink-0 items-center justify-center font-extrabold" style={{ width: vw(3.6), height: vw(3.6), borderRadius: vw(0.9), fontSize: vw(2.2), color, background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
                {String.fromCharCode(65 + index)}
              </span>
              <div className="min-w-0">
                <p className="font-bold leading-[1.1]" style={{ fontSize: vw(2.1) }}>{item.title}</p>
                {item.section ? <p className="text-white/60" style={{ fontSize: vw(1.4) }}>{item.section}</p> : null}
              </div>
            </div>
            {item.prescription ? (
              <p className="whitespace-pre-line font-semibold leading-[1.45]" style={{ fontSize: vw(1.85), marginTop: vw(1.4) }}>{item.prescription}</p>
            ) : null}
            {item.scaling ? <p className="text-white/55" style={{ fontSize: vw(1.25), marginTop: vw(0.8) }}>Scale: {item.scaling}</p> : null}
          </section>
        );
      })}
    </div>
  );
}

export function DisplayBoard({ token, initial }: { token: string; initial: DisplayPayload }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/display/${token}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as DisplayPayload;
        if (!cancelled) {
          setData(next);
          setStale(false);
        }
      } catch {
        // Keep showing the last good workout if the network drops mid-class.
        if (!cancelled) setStale(true);
      }
    };
    const poll = setInterval(refresh, REFRESH_MS);
    // The clock starts on the client so the server-rendered page and the browser never disagree.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [token]);

  const timeZone = data.timezone || "UTC";
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${data.date}T00:00:00Z`));
  const clock = now ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now).replace(/ [AP]M/, "") : "";
  const next = data.next_class;
  const classTime = next ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(next.starts_at)) : null;
  // Lead with the workout for the class that is about to start.
  const workouts = [...data.workouts].sort((a, b) => Number(b.track === next?.track) - Number(a.track === next?.track));
  const compact = workouts.length > 1;
  const timer = next && now ? countdown(next.starts_at, now) : null;

  return (
    <main className="flex min-h-screen flex-col bg-black px-[4.2vw] py-[3.2vw] text-white" style={{ backgroundImage: "radial-gradient(60% 55% at 85% 0%, rgba(233,21,45,0.22), rgba(233,21,45,0) 70%)" }}>
      <header className="flex items-center justify-between gap-[3vw]">
        <div className="flex items-center gap-[1.4vw]">
          <span className="brand flex items-center justify-center text-white" style={{ width: "3.8vw", height: "3.8vw", borderRadius: "1vw", fontSize: "2.3vw", lineHeight: 1, background: "linear-gradient(160deg, #ff4b4e 0%, #c8102e 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)" }}>F</span>
          <span className="brand text-[2.4vw] leading-none">{data.gym.replace(/ athletics$/i, "")}</span>
          <span className="text-[1.2vw] font-bold uppercase leading-none tracking-[0.3vw] text-accent">Athletics</span>
        </div>
        <div className="flex items-center gap-[2.2vw]">
          <div className="text-right text-[1.5vw] leading-[1.25] text-white/65">
            <p>{date}</p>
            {next?.coach ? <p>Coach {next.coach}</p> : null}
          </div>
          <p className="text-[5vw] font-extrabold leading-none tracking-[-0.15vw] tabular-nums" suppressHydrationWarning>{clock}</p>
        </div>
      </header>

      {data.message ? (
        <p className="mt-[2vw] rounded-[1.2vw] bg-accent/15 px-[1.6vw] py-[1vw] text-[1.9vw] font-semibold shadow-[inset_0_0_0_1.5px_rgba(255,66,69,0.5)]">{data.message}</p>
      ) : null}

      {workouts.length ? (
        <div className="mt-[2.6vw] flex flex-1 gap-[1.6vw]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2vw]">
            {workouts.map((workout, index) => (
              <article key={workout.id} data-testid="display-workout" className="flex flex-1 flex-col">
                <div className="mb-[1.4vw] flex flex-wrap items-baseline gap-x-[1.6vw]">
                  <p className="brand leading-[0.95]" style={{ fontSize: compact ? "3.6vw" : "6.8vw", color: compact ? (workout.track_color ?? "#fff") : "#fff" }}>{workout.track ?? "Workout"}</p>
                  <h2 className="font-semibold text-white/65" style={{ fontSize: compact ? "1.9vw" : "2.3vw" }}>
                    {index === 0 && classTime && workout.track === next?.track ? `${classTime} · ` : ""}{workout.title}
                  </h2>
                </div>
                <Blocks workout={workout} compact={compact} />
                {workout.coach_notes ? <p className="mt-[1vw] text-[1.3vw] italic text-white/60">Coach: {workout.coach_notes}</p> : null}
              </article>
            ))}
          </div>

          {next ? (
            <aside className="flex w-[22vw] shrink-0 flex-col gap-[1.2vw]">
              <section className="rounded-[1.6vw] bg-[#141416] p-[1.7vw]">
                <p className="text-[1.3vw] font-bold uppercase tracking-[0.08vw] text-white/60">{timer?.label ?? "Next class"}</p>
                <p className="mt-[0.3vw] font-extrabold leading-none tracking-[-0.12vw] text-accent tabular-nums" style={{ fontSize: timer?.value === "In progress" ? "2.6vw" : "5.4vw" }} suppressHydrationWarning>{timer?.value ?? classTime}</p>
                <p className="mt-[0.6vw] text-[1.3vw] text-white/60">{next.title}{classTime ? ` · ${classTime}` : ""}</p>
              </section>
              <section className="flex-1 rounded-[1.6vw] bg-[#141416] p-[1.7vw]">
                <div className="flex items-baseline justify-between">
                  <p className="text-[1.3vw] font-bold uppercase tracking-[0.08vw] text-white/60">Checked in</p>
                  <p className="text-[1.5vw] font-bold tabular-nums">{next.checked_in} / {next.booked}</p>
                </div>
                <ul className="mt-[0.8vw] space-y-[0.5vw] text-[1.7vw] font-semibold">
                  {next.checked_in_names.slice(0, 7).map((name, i) => <li key={`${name}-${i}`}>{name}</li>)}
                  {next.checked_in_names.length > 7 ? <li className="text-white/50">+{next.checked_in_names.length - 7} more</li> : null}
                </ul>
              </section>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[2.4vw] text-white/40">{data.mode === "off" || data.message ? "" : "No workout published for today yet."}</p>
        </div>
      )}

      {stale ? <p className="mt-4 text-right text-xs text-white/30">Offline — showing the last update</p> : null}
    </main>
  );
}
