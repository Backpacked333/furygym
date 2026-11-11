import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, gymId, makeMember, newAthlete, newSession, service, signIn } from "../../../supabase/tests/helpers";

let viewer: Awaited<ReturnType<typeof newAthlete>>;
let owner: Awaited<ReturnType<typeof signIn>>;
let gym: string;
let today: string;
vi.mock("@/lib/api-auth", () => ({ authenticate: async () => ({ user: { id: viewer.id }, supabase: viewer.client }) }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ supabase: owner, gym: { id: gym } }) }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => service() }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => null, PAYMENTS_OFF: "Payments are off" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/membership/route";
import { updateMembership } from "@/app/admin/members/actions";

beforeAll(async () => {
  gym = await gymId();
  owner = await signIn("owner@furyco.test");
  today = (await service().rpc("gym_today", { p_gym: gym })).data;
});

async function cancel(id: string) {
  return POST(new Request("http://localhost/api/membership", { method: "POST", body: JSON.stringify({ action: "cancel", membership_id: id }) }));
}

describe("membership lifecycle", () => {
  it("keeps a non-renewing pack's credits, status and paid-through date", async () => {
    viewer = await newAthlete("pack-cancel");
    const membership = await makeMember(viewer.id, { credits: 3 });
    const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await service().from("memberships").update({ ends_at: expiry }).eq("id", membership.id);
    expect((await cancel(membership.id)).status).toBe(200);
    const row = (await service().from("memberships").select("status,credits_remaining,ends_at").eq("id", membership.id).single()).data!;
    expect(row.status).toBe("active"); expect(row.credits_remaining).toBe(3);
    expect(Date.parse(row.ends_at)).toBe(Date.parse(expiry));
  });

  it("does not end an indefinite comp under a paid-through cancellation promise", async () => {
    viewer = await newAthlete("comp-cancel");
    const membership = await makeMember(viewer.id);
    expect((await cancel(membership.id)).status).toBe(409);
    expect((await service().from("memberships").select("status,ends_at").eq("id", membership.id).single()).data).toEqual({ status: "active", ends_at: null });
  });

  it("does not let another athlete change the membership", async () => {
    const other = await newAthlete("membership-owner");
    const membership = await makeMember(other.id, { credits: 3 });
    viewer = await newAthlete("membership-other");
    expect((await cancel(membership.id)).status).toBe(404);
  });

  it("uses the booking-aware transaction for the staff freeze action", async () => {
    viewer = await newAthlete("staff-freeze");
    const membership = await makeMember(viewer.id);
    const waiter = await newAthlete("staff-freeze-waiter"); await makeMember(waiter.id);
    const session = await newSession(1);
    const original = await viewer.client.rpc("book_class", { p_session: session.id });
    const waiting = await waiter.client.rpc("book_class", { p_session: session.id });
    expect(original.error).toBeNull(); expect(waiting.data.status).toBe("waitlisted");
    const data = new FormData();
    data.set("id", membership.id); data.set("op", "freeze"); data.set("frozen_until", addDays(today, 14));
    expect(await updateMembership(null, data)).toEqual({ ok: "Membership updated." });
    expect((await service().from("bookings").select("status").eq("id", original.data.id).single()).data?.status).toBe("cancelled");
    expect((await service().from("bookings").select("status").eq("id", waiting.data.id).single()).data?.status).toBe("booked");
  });
});
