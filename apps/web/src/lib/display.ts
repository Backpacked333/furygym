export type DisplayItem = { id: string; section: string | null; title: string; prescription: string | null; scaling: string | null; notes: string | null };
export type DisplayWorkout = { id: string; title: string; description: string | null; coach_notes: string | null; track: string | null; track_color: string | null; items: DisplayItem[] };
export type DisplayClass = {
  id: string; title: string; starts_at: string; track: string | null; track_color: string | null; coach: string | null;
  capacity: number; booked: number; checked_in: number; checked_in_names: string[];
};
export type DisplayPayload = {
  gym: string; date: string; timezone: string; mode: "auto" | "manual" | "off"; message: string | null;
  workouts: DisplayWorkout[]; next_class: DisplayClass | null; updated_at: string;
};
