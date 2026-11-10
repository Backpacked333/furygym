"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";

export type ScanResult = {
  result: "checked_in" | "already_checked_in" | "no_booking" | "expired_code" | "invalid_code" | "error";
  athlete?: string;
  class?: string;
  starts_at?: string;
  session_id?: string;
  message?: string;
};

export async function scanCode(payload: string): Promise<ScanResult> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.rpc("check_in_with_code", { p_payload: payload });
  if (error) return { result: "error", message: error.message };
  const result = data as unknown as ScanResult;
  if (result.session_id) revalidatePath(`/admin/schedule/sessions/${result.session_id}`);
  return result;
}
