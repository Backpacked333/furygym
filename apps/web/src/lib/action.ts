export type ActionState = { error?: string; ok?: string } | null;

const friendly: Record<string, string> = {
  waiver_required: "The athlete must sign the waiver first.",
  no_entitlement: "No active membership or class credits.",
  session_started: "This class has already started.",
  session_cancelled: "This class is cancelled.",
  booking_not_open: "Booking has not opened for this class yet.",
  not_a_member: "That person is not a member of the gym.",
  class_full: "This class is full. Free a place before restoring this booking.",
  capacity_below_bookings: "Capacity cannot be lower than the number of occupied places.",
  nonexistent_local_time: "The schedule includes a time that does not exist when the clocks change. Change that class time or generate a different date range.",
  ambiguous_local_time: "The schedule includes a time that occurs twice when the clocks change. Choose an unambiguous class time.",
  forbidden: "You do not have permission to do that.",
  invalid_range: "Choose a range of up to 180 days.",
  program_already_started: "The program has already started.",
  waiver_text_required: "Enter a title and the full agreement text.",
};

/** Turns a database or Stripe error into a message a staff member can act on. */
export function fail(error: { message?: string } | string | null | undefined): ActionState {
  const message = typeof error === "string" ? error : (error?.message ?? "Something went wrong.");
  return { error: friendly[message] ?? message };
}

export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optional(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

export function integer(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** "185" or "185.50" dollars → cents. */
export function cents(form: FormData, name: string): number | null {
  const raw = text(form, name).replace(/[$,]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}
