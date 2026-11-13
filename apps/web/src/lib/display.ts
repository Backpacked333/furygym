export type DisplayItem = { id: string; section: string | null; title: string; prescription: string | null; scaling: string | null; notes: string | null };
export type DisplayWorkout = { id: string; title: string; description: string | null; coach_notes: string | null; track: string | null; track_color: string | null; items: DisplayItem[] };
export type DisplayClass = {
  id: string; title: string; starts_at: string; ends_at: string; track: string | null; track_color: string | null; coach: string | null;
  capacity: number; booked: number; checked_in: number; checked_in_names: string[];
};
export type DisplayPayload = {
  gym: string; date: string; timezone: string; mode: "auto" | "manual" | "off"; message: string | null;
  workouts: DisplayWorkout[]; next_class: DisplayClass | null; updated_at: string; server_time: string;
};

/** How often a screen asks for the latest display. */
export const REFRESH_MS = 30_000;
/** A screen that has not reported in for this long is treated as disconnected. */
export const SCREEN_ONLINE_MS = 3 * REFRESH_MS;

/** Whether a screen is using the display link, from when one last reported in. */
export function screenStatus(seenAt: string | null | undefined, now: number): "never" | "online" | "offline" {
  if (!seenAt) return "never";
  return now - new Date(seenAt).getTime() <= SCREEN_ONLINE_MS ? "online" : "offline";
}

/** The class card's timer. Null once the class is over, so a screen that lost its connection stops claiming it. */
export function classTimer(next: Pick<DisplayClass, "starts_at" | "ends_at">, now: number): { label: string; value: string; live: boolean } | null {
  if (now >= new Date(next.ends_at).getTime()) return null;
  const diff = Math.round((new Date(next.starts_at).getTime() - now) / 1000);
  if (diff <= 0) return { label: "Class", value: "In progress", live: true };
  const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return { label: "Starts in", value: h > 0 ? `${h}:${mmss}` : mmss, live: false };
}

/** How far the server's clock is ahead of this device's, from a response received between `sent` and `received`. */
export function clockOffset(serverTime: string | undefined, sent: number, received: number): number | null {
  const server = serverTime ? new Date(serverTime).getTime() : NaN;
  return Number.isFinite(server) ? server - (sent + received) / 2 : null;
}
