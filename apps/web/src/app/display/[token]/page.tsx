import { notFound } from "next/navigation";
import type { DisplayPayload } from "@/lib/display";
import { createPublicClient } from "@/lib/supabase/server";
import { DisplayBoard } from "./board";

export const metadata = { title: "Gym display", robots: { index: false } };

export default async function DisplayPage({ params }: PageProps<"/display/[token]">) {
  const { token } = await params;
  const { data } = await createPublicClient().rpc("get_display", { p_token: token });
  if (!data) notFound();
  return <DisplayBoard token={token} initial={data as unknown as DisplayPayload} />;
}
