export type DisplayItem = { id: string; section: string | null; title: string; prescription: string | null; scaling: string | null; notes: string | null };
export type DisplayWorkout = { id: string; title: string; description: string | null; coach_notes: string | null; track: string | null; track_color: string | null; items: DisplayItem[] };
export type DisplayPayload = { gym: string; date: string; mode: "auto" | "manual" | "off"; message: string | null; workouts: DisplayWorkout[]; updated_at: string };
