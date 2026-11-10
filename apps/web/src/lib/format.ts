export function money(cents: number | null | undefined, currency = "usd"): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(value);
}

/** "2026-11-10" for a moment in time, in the gym's timezone. */
export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayInZone(timeZone: string): string {
  return dateInZone(new Date(), timeZone);
}

/** Adds days to a calendar date string without going through local time. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads `date` `time` (e.g. "2026-11-10", "18:00"). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m ?? 0);
  // Two passes settle on the right offset either side of a daylight-saving change.
  let result = guess - zoneOffsetMs(new Date(guess), timeZone);
  result = guess - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/** "HH:MM" wall-clock time in the gym's timezone, for <input type="time">. */
export function timeInputValue(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
