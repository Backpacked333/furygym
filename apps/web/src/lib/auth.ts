import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Gym = Database["public"]["Tables"]["gyms"]["Row"];
export type GymRole = Database["public"]["Enums"]["gym_role"];

/** The gym this deployment runs. The pilot has exactly one. */
export const getGym = cache(async (): Promise<Gym> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("gyms").select("*").eq("is_default", true).single();
  if (error || !data) throw new Error(`Could not load the gym: ${error?.message ?? "no default gym"}`);
  return data;
});

/** The signed-in user with their role in the gym, or null when signed out. */
export const getViewer = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const gym = await getGym();
  const [{ data: member }, { data: profile }] = await Promise.all([
    supabase.from("gym_members").select("role, status").eq("gym_id", gym.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);
  const role: GymRole | null = member?.status === "active" ? member.role : null;
  return {
    supabase,
    user,
    gym,
    profile,
    role,
    isStaff: role === "coach" || role === "admin" || role === "owner",
    isAdmin: role === "admin" || role === "owner",
  };
});

export async function requireUser() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Coaches, admins and owners. Athletes are sent to their own account page. */
export async function requireStaff() {
  const viewer = await requireUser();
  if (!viewer.isStaff) redirect("/account");
  return viewer;
}

/** Admins and owners only: money, memberships, roles, schedule and settings. */
export async function requireAdmin() {
  const viewer = await requireStaff();
  if (!viewer.isAdmin) redirect("/admin?denied=1");
  return viewer;
}
