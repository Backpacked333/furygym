"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { classTimer, clockOffset, REFRESH_MS, type DisplayPayload, type DisplayWorkout } from "@/lib/display";
import { dateInZone } from "@/lib/format";

const REQUEST_TIMEOUT_MS = 10_000;
const MIN_FIT = 0.5;
const BLOCK_COLORS = ["#ff4245", "#ff4245", "#ff9230", "#6d7cff", "#30d158", "#ffd600"];

/** A viewport-relative size that shrinks with --fit when the workout is too long for the screen. */
const fit = (n: number) => `calc(${n.toFixed(2)}vw * var(--fit, 1))`;

type View = {
  data: DisplayPayload;
  /** live: up to date. stale: refreshes are failing. revoked: the link was replaced. */
  status: "live" | "stale" | "revoked";
  /** Server clock minus this device's clock, in milliseconds. */
  offset: number;
  /** When the display last refreshed, on the server's clock. */
  refreshedAt: number;
};

function Blocks({ workout, compact }: { workout: DisplayWorkout; compact: boolean }) {
  const scale = compact ? 0.72 : 1;
  const vw = (n: number) => fit(n * scale);
  return (
    <div className="grid flex-1" style={{ gap: fit(1.4), gridTemplateColumns: `repeat(${Math.min(Math.max(workout.items.length, 1), 4)}, minmax(0, 1fr))` }}>
      {workout.items.map((item, index) => {
        const color = BLOCK_COLORS[index % BLOCK_COLORS.length];
        return (
          <section key={item.id} className="bg-[#141416]" style={{ padding: vw(1.8), borderRadius: fit(1.6) }}>
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

function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center" role="status">
      <p className="text-[3vw] font-bold">{title}</p>
      <p className="mt-[1vw] text-[1.7vw] text-white/55">{detail}</p>
    </div>
  );
}

export function DisplayBoard({ token, preview = false, initial }: { token: string; preview?: boolean; initial: DisplayPayload }) {
  const [view, setView] = useState<View>(() => {
    const served = new Date(initial.server_time).getTime();
    return { data: initial, status: "live", offset: 0, refreshedAt: Number.isFinite(served) ? served : 0 };
  });
  const [now, setNow] = useState<number | null>(null);
  const board = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      const sent = Date.now();
      try {
        const res = await fetch(`/api/display/${token}${preview ? "?preview" : ""}`, { cache: "no-store", signal: abort.signal });
        if (res.status === 404) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (body?.error !== "not_found") throw new Error("404");
          // The link was replaced: stop showing what it used to show.
          if (!cancelled) setView((v) => ({ ...v, status: "revoked" }));
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as DisplayPayload;
        const offset = clockOffset(next.server_time, sent, Date.now());
        if (!cancelled) setView((v) => ({ data: next, status: "live", offset: offset ?? v.offset, refreshedAt: Date.now() + (offset ?? v.offset) }));
      } catch {
        // Keep showing the last good workout if the network drops mid-class.
        if (!cancelled) setView((v) => (v.status === "live" ? { ...v, status: "stale" } : v));
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Refresh straight away: it reports the screen as connected and reads the server's clock.
    const first = setTimeout(() => {
      const loaded = Date.now();
      // Until the first reply, take the server's clock from the page itself, so a TV with the wrong
      // date does not judge today's workout as yesterday's if that reply never comes.
      setView((v) => {
        const served = new Date(v.data.server_time).getTime();
        return v.offset === 0 && Number.isFinite(served) ? { ...v, offset: served - loaded } : v;
      });
      setNow(loaded);
      void refresh();
    }, 0);
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [token, preview]);

  // A TV cannot scroll, so a long workout is shrunk until the whole of it is on screen. Below MIN_FIT the
  // text is too small to read across a room, so past that the screen says it is cut off rather than hide it.
  const fitToScreen = useCallback(() => {
    const el = board.current;
    if (!el) return;
    let scale = 1;
    el.style.setProperty("--fit", "1");
    while (el.scrollHeight > el.clientHeight + 1 && scale > MIN_FIT) {
      scale = Math.max(MIN_FIT, scale - 0.04);
      el.style.setProperty("--fit", scale.toFixed(2));
    }
    el.toggleAttribute("data-overflow", el.scrollHeight > el.clientHeight + 1);
  }, []);
  useLayoutEffect(fitToScreen, [fitToScreen, view.data, view.status]);
  useEffect(() => {
    window.addEventListener("resize", fitToScreen);
    return () => window.removeEventListener("resize", fitToScreen);
  }, [fitToScreen]);

  const { data, status } = view;
  const time = now === null ? null : now + view.offset;
  const timeZone = data.timezone || "UTC";
  const hourMinute = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  // Yesterday's workout is worse than none: a screen that has been cut off overnight stops showing it.
  const expired = status === "stale" && time !== null && dateInZone(new Date(time), timeZone) !== data.date;
  const hidden = status === "revoked" || expired;

  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${time === null || status === "live" ? data.date : dateInZone(new Date(time), timeZone)}T00:00:00Z`));
  const clock = time ? hourMinute.format(time).replace(/ [AP]M/, "") : "";
  const timer = data.next_class && time !== null ? classTimer(data.next_class, time) : null;
  // Once its class has ended the card goes, even if the screen cannot reach the server to learn what is next.
  const next = hidden || (time !== null && !timer) ? null : data.next_class;
  const classTime = next ? hourMinute.format(new Date(next.starts_at)) : null;
  const classEnd = next ? hourMinute.format(new Date(next.ends_at)) : null;
  // Lead with the workout for the class that is about to start.
  const workouts = hidden ? [] : [...data.workouts].sort((a, b) => Number(b.track === next?.track) - Number(a.track === next?.track));
  const compact = workouts.length > 1;
  const message = hidden ? null : data.message;

  return (
    <main ref={board} data-status={status} className="flex h-screen flex-col overflow-hidden bg-black px-[4.2vw] py-[3.2vw] text-white" style={{ backgroundImage: "radial-gradient(60% 55% at 85% 0%, rgba(233,21,45,0.22), rgba(233,21,45,0) 70%)" }}>
      <header className="flex shrink-0 items-center justify-between gap-[3vw]">
        <div className="flex items-center gap-[1.4vw]">
          <span className="brand flex items-center justify-center text-white" style={{ width: "3.8vw", height: "3.8vw", borderRadius: "1vw", fontSize: "2.3vw", lineHeight: 1, background: "linear-gradient(160deg, #ff4b4e 0%, #c8102e 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)" }}>F</span>
          <span className="brand text-[2.4vw] leading-none">{data.gym.replace(/ athletics$/i, "")}</span>
          <span className="text-[1.2vw] font-bold uppercase leading-none tracking-[0.3vw] text-accent">Athletics</span>
        </div>
        <div className="flex items-center gap-[2.2vw]">
          <div className="text-right text-[1.5vw] leading-[1.25] text-white/65">
            <p suppressHydrationWarning>{date}</p>
            {next?.coach ? <p>Coach {next.coach}</p> : null}
          </div>
          <p className="text-[5vw] font-extrabold leading-none tracking-[-0.15vw] tabular-nums" suppressHydrationWarning>{clock}</p>
        </div>
      </header>

      {message ? (
        <p className="mt-[2vw] shrink-0 rounded-[1.2vw] bg-accent/15 px-[1.6vw] py-[1vw] text-[1.9vw] font-semibold shadow-[inset_0_0_0_1.5px_rgba(255,66,69,0.5)]">{message}</p>
      ) : null}

      {status === "revoked" ? (
        <Notice title="This display link is no longer active" detail="Open the current link from Displays in the staff console." />
      ) : expired ? (
        <Notice title="Display offline" detail="Today’s workout will appear when the connection is back." />
      ) : workouts.length ? (
        <div className="mt-[2.6vw] flex min-h-0 flex-1 gap-[1.6vw]">
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: fit(2) }}>
            {workouts.map((workout, index) => (
              <article key={workout.id} data-testid="display-workout" className="flex flex-1 flex-col">
                <div className="flex flex-wrap items-baseline gap-x-[1.6vw]" style={{ marginBottom: fit(1.4) }}>
                  <p className="brand leading-[0.95]" style={{ fontSize: fit(compact ? 3.6 : 6.8), color: compact ? (workout.track_color ?? "#fff") : "#fff" }}>{workout.track ?? "Workout"}</p>
                  <h2 className="font-semibold text-white/65" style={{ fontSize: fit(compact ? 1.9 : 2.3) }}>
                    {index === 0 && classTime && workout.track === next?.track ? `${classTime} · ` : ""}{workout.title}
                  </h2>
                </div>
                <Blocks workout={workout} compact={compact} />
                {workout.coach_notes ? <p className="italic text-white/60" style={{ marginTop: fit(1), fontSize: fit(1.3) }}>Coach: {workout.coach_notes}</p> : null}
              </article>
            ))}
          </div>

          {next ? (
            <aside className="flex min-h-0 w-[22vw] shrink-0 flex-col gap-[1.2vw]" data-testid="display-class">
              <section className="rounded-[1.6vw] bg-[#141416] p-[1.7vw]">
                <p className="text-[1.3vw] font-bold uppercase tracking-[0.08vw] text-white/60">{timer?.label ?? "Next class"}</p>
                <p className="mt-[0.3vw] font-extrabold leading-none tracking-[-0.12vw] text-accent tabular-nums" style={{ fontSize: timer?.live ? "2.6vw" : "5.4vw" }} suppressHydrationWarning>{timer?.value ?? classTime}</p>
                <p className="mt-[0.6vw] text-[1.3vw] text-white/60" suppressHydrationWarning>{next.title} · {timer?.live ? `until ${classEnd}` : classTime}</p>
              </section>
              {/* Attendance kept in another system never reaches this screen, so an empty roster shows nothing rather than "0 / 0". */}
              {next.booked > 0 || next.checked_in > 0 ? (
                <section className="min-h-0 flex-1 overflow-hidden rounded-[1.6vw] bg-[#141416] p-[1.7vw]">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[1.3vw] font-bold uppercase tracking-[0.08vw] text-white/60">Checked in</p>
                    <p className="text-[1.5vw] font-bold tabular-nums">{next.checked_in} / {next.booked}</p>
                  </div>
                  <ul className="mt-[0.8vw] space-y-[0.5vw] text-[1.7vw] font-semibold">
                    {next.checked_in_names.slice(0, 7).map((name, i) => <li key={`${name}-${i}`}>{name}</li>)}
                    {next.checked_in_names.length > 7 ? <li className="text-white/50">+{next.checked_in_names.length - 7} more</li> : null}
                  </ul>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[2.4vw] text-white/40">{data.mode === "off" || data.message ? "" : "No workout published for today yet."}</p>
        </div>
      )}

      <p role="status" data-testid="display-overflow" className="fixed bottom-[1.4vw] left-[1.8vw] hidden rounded-full bg-[#3a2a00] px-[1.3vw] py-[0.5vw] text-[1.3vw] font-semibold text-[#ffd600] shadow-[inset_0_0_0_1.5px_rgba(255,214,0,0.45)] [[data-overflow]_&]:block">
        Too much to fit on this screen · show one track or pin a workout in Displays
      </p>

      {status === "stale" ? (
        <p role="status" className="fixed bottom-[1.4vw] right-[1.8vw] rounded-full bg-[#3a2a00] px-[1.3vw] py-[0.5vw] text-[1.3vw] font-semibold text-[#ffd600] shadow-[inset_0_0_0_1.5px_rgba(255,214,0,0.45)]">
          Offline · last updated {hourMinute.format(view.refreshedAt)} · reconnecting
        </p>
      ) : null}
    </main>
  );
}
