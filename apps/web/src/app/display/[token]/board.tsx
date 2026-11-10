"use client";

import { useEffect, useState } from "react";
import type { DisplayPayload } from "@/lib/display";

const REFRESH_MS = 30_000;

export function DisplayBoard({ token, initial }: { token: string; initial: DisplayPayload }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);

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
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${data.date}T00:00:00Z`));
  const columns = data.workouts.length > 1 ? "lg:grid-cols-2" : "";

  return (
    <main className="flex min-h-screen flex-col bg-black px-[3vw] py-[2.5vw] text-white">
      <header className="flex items-baseline justify-between gap-6 border-b border-white/15 pb-[1.2vw]">
        <h1 className="text-[2.2vw] font-semibold uppercase tracking-[0.2em] text-accent">{data.gym}</h1>
        <p className="text-[1.8vw] text-white/70">{date}</p>
      </header>

      {data.message ? (
        <p className="mt-[1.5vw] rounded-[0.8vw] border border-accent/50 bg-accent/10 px-[1.5vw] py-[1vw] text-[2vw] font-medium">{data.message}</p>
      ) : null}

      {data.workouts.length ? (
        <div className={`mt-[2vw] grid flex-1 gap-[2.5vw] ${columns}`}>
          {data.workouts.map((workout) => (
            <article key={workout.id} data-testid="display-workout">
              <p className="flex items-center gap-[0.8vw] text-[1.5vw] font-semibold uppercase tracking-widest text-white/60">
                <span className="inline-block size-[1vw] rounded-full" style={{ background: workout.track_color ?? "#888" }} />
                {workout.track}
              </p>
              <h2 className="mt-[0.4vw] text-[3.6vw] font-bold leading-tight">{workout.title}</h2>
              {workout.description ? <p className="mt-[0.6vw] text-[1.6vw] text-white/70">{workout.description}</p> : null}
              <ol className="mt-[1.5vw] space-y-[1.4vw]">
                {workout.items.map((item) => (
                  <li key={item.id} className="border-l-[0.3vw] border-white/20 pl-[1.2vw]">
                    {item.section ? <p className="text-[1.1vw] font-semibold uppercase tracking-widest text-accent">{item.section}</p> : null}
                    <p className="text-[2.4vw] font-semibold leading-tight">{item.title}</p>
                    {item.prescription ? <p className="whitespace-pre-line text-[2vw] leading-snug text-white/90">{item.prescription}</p> : null}
                    {item.scaling ? <p className="mt-[0.3vw] text-[1.3vw] text-white/55">Scale: {item.scaling}</p> : null}
                  </li>
                ))}
              </ol>
              {workout.coach_notes ? <p className="mt-[1.5vw] text-[1.4vw] italic text-white/60">Coach: {workout.coach_notes}</p> : null}
            </article>
          ))}
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
