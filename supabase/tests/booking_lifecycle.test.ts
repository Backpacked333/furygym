import { beforeAll, describe, expect, it } from "vitest";
import { gymId, makeMember, newAthlete, newSession, service, signIn } from "./helpers";

let gym: string;
let owner: Awaited<ReturnType<typeof signIn>>;
beforeAll(async () => { gym = await gymId(); owner = await signIn("owner@furyco.test"); });
const db = service();
async function pair() {
  const a = await newAthlete("reserved");
  const b = await newAthlete("waiting");
  const membership = await makeMember(a.id, { credits: 3 });
  await makeMember(b.id);
  const session = await newSession(1);
  const first = await a.client.rpc("book_class", { p_session: session.id });
  const waiting = await b.client.rpc("book_class", { p_session: session.id });
  expect(first.error).toBeNull(); expect(waiting.error).toBeNull();
  expect(waiting.data.status).toBe("waitlisted");
  return { a, b, membership, session, first: first.data, waiting: waiting.data };
}
async function booking(id: string) { return (await db.from("bookings").select("*").eq("id", id).single()).data!; }

describe("booking lifecycle", () => {
  it("preserves the existing past-due grace policy for reservations and check-in", async () => {
    const athlete = await newAthlete("past-due-grace"); const membership = await makeMember(athlete.id);
    const session = await newSession(1, 1);
    const reservation = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(reservation.error).toBeNull();
    await db.from("memberships").update({ status: "past_due" }).eq("id", membership.id);
    expect((await db.from("bookings").select("status").eq("id", reservation.data.id).single()).data?.status).toBe("booked");
    expect((await owner.rpc("check_in", { p_booking: reservation.data.id })).error).toBeNull();
  });

  it("rejects a stale paid check-in after cancellation without breaking explicit staff walk-ins", async () => {
    const athlete = await newAthlete("cancelled-checkin"); const membership = await makeMember(athlete.id);
    const walkin = await newAthlete("staff-walkin");
    const session = await newSession(2, 1);
    const paid = await athlete.client.rpc("book_class", { p_session: session.id });
    const free = await owner.rpc("book_class", { p_session: session.id, p_user: walkin.id });
    expect(paid.error).toBeNull(); expect(free.error).toBeNull();
    await db.from("class_sessions").update({ starts_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", session.id);
    await db.from("memberships").update({ status: "cancelled" }).eq("id", membership.id);
    expect((await owner.rpc("check_in", { p_booking: paid.data.id })).error?.message).toBe("no_entitlement");
    expect((await owner.rpc("check_in", { p_booking: free.data.id })).error).toBeNull();
  });

  it("releases future paid reservations when their membership is cancelled or ends early", async () => {
    for (const patch of [{ status: "cancelled" }, { ends_at: new Date().toISOString() }]) {
      const athlete = await newAthlete("ended-booking"); const membership = await makeMember(athlete.id, { credits: 2 });
      const waiter = await newAthlete("ended-waiter"); await makeMember(waiter.id);
      const session = await newSession(1);
      const reservation = await athlete.client.rpc("book_class", { p_session: session.id });
      const waiting = await waiter.client.rpc("book_class", { p_session: session.id });
      expect(reservation.error).toBeNull(); expect(waiting.data.status).toBe("waitlisted");
      expect((await db.from("memberships").update(patch).eq("id", membership.id)).error).toBeNull();
      expect((await db.from("bookings").select("status").eq("id", reservation.data.id).single()).data?.status).toBe("cancelled");
      expect((await db.from("bookings").select("status").eq("id", waiting.data.id).single()).data?.status).toBe("booked");
    }
  });

  it("does not silently move a recurring class across a daylight-saving gap or fold", async () => {
    const schedule = await db.from("class_schedules").insert({ gym_id: gym, title: "DST schedule regression", weekday: 0, start_time: "02:30", duration_minutes: 60, capacity: 8 }).select().single();
    expect(schedule.error).toBeNull();
    try {
      const gap = await owner.rpc("generate_sessions", { p_gym: gym, p_from: "2027-03-14", p_to: "2027-03-14" });
      expect(gap.error?.message).toBe("nonexistent_local_time");
      expect((await db.from("class_sessions").select("id").eq("schedule_id", schedule.data!.id)).data).toHaveLength(0);
      await db.from("class_schedules").update({ start_time: "01:30" }).eq("id", schedule.data!.id);
      expect((await owner.rpc("generate_sessions", { p_gym: gym, p_from: "2027-11-07", p_to: "2027-11-07" })).error?.message).toBe("ambiguous_local_time");
      await db.from("class_schedules").update({ start_time: "03:30" }).eq("id", schedule.data!.id);
      expect((await owner.rpc("generate_sessions", { p_gym: gym, p_from: "2027-03-14", p_to: "2027-03-14" })).error).toBeNull();
      const session = (await db.from("class_sessions").select("starts_at").eq("schedule_id", schedule.data!.id).single()).data!;
      expect(new Date(session.starts_at).toISOString()).toBe("2027-03-14T08:30:00.000Z");
    } finally {
      await db.from("class_sessions").delete().eq("schedule_id", schedule.data!.id);
      await db.from("class_schedules").delete().eq("id", schedule.data!.id);
    }
  });

  it("cancels the entire future roster and refunds once without promoting into a cancelled class", async () => {
    const f = await pair();
    for (let n = 0; n < 2; n++) expect((await owner.from("class_sessions").update({ status: "cancelled" }).eq("id", f.session.id)).error).toBeNull();
    expect((await booking(f.first.id)).status).toBe("cancelled");
    expect((await booking(f.waiting.id)).status).toBe("cancelled");
    expect((await db.from("memberships").select("credits_remaining").eq("id", f.membership.id).single()).data?.credits_remaining).toBe(3);
    expect((await owner.rpc("check_in", { p_booking: f.first.id })).error?.message).toBe("session_cancelled");
    expect((await f.b.client.rpc("book_class", { p_session: f.session.id })).error?.message).toBe("session_cancelled");
  });

  it("preserves historical attendance when a class is cancelled", async () => {
    const f = await pair();
    expect((await owner.rpc("check_in", { p_booking: f.first.id })).error).toBeNull();
    expect((await owner.from("class_sessions").update({ status: "cancelled" }).eq("id", f.session.id)).error).toBeNull();
    expect((await booking(f.first.id)).status).toBe("attended");
    expect((await db.from("memberships").select("credits_remaining").eq("id", f.membership.id).single()).data?.credits_remaining).toBe(2);
  });

  it("gives increased capacity to the existing waitlist first and rejects over-shrinking", async () => {
    const f = await pair();
    expect((await owner.from("class_sessions").update({ capacity: 2 }).eq("id", f.session.id)).error).toBeNull();
    expect((await booking(f.waiting.id)).status).toBe("booked");
    expect((await owner.from("class_sessions").update({ capacity: 1 }).eq("id", f.session.id)).error?.message).toBe("capacity_below_bookings");
    const newcomer = await newAthlete("late-arrival"); await makeMember(newcomer.id);
    expect((await newcomer.client.rpc("book_class", { p_session: f.session.id })).data.status).toBe("waitlisted");
  });

  it("releases a deleted athlete's place to a waiting athlete", async () => {
    const f = await pair();
    expect((await db.auth.admin.deleteUser(f.a.id)).error).toBeNull();
    expect((await booking(f.waiting.id)).status).toBe("booked");
  });

  it("does not restore a no-show into a reassigned seat", async () => {
    const f = await pair();
    expect((await owner.rpc("check_in", { p_booking: f.first.id, p_status: "no_show" })).error).toBeNull();
    expect((await booking(f.waiting.id)).status).toBe("booked");
    for (const status of ["booked", "attended"]) {
      expect((await owner.rpc("check_in", { p_booking: f.first.id, p_status: status })).error?.message).toBe("class_full");
    }
    expect((await booking(f.first.id)).status).toBe("no_show");
  });

  it("revokes inactive athletes' unlogged access, releases reservations, and skips them on the waitlist", async () => {
    const f = await pair();
    expect((await owner.from("gym_members").update({ status: "inactive" }).eq("user_id", f.b.id).eq("gym_id", gym)).error).toBeNull();
    const next = await newAthlete("eligible-next"); await makeMember(next.id);
    const nextBooking = await next.client.rpc("book_class", { p_session: f.session.id });
    expect((await owner.from("gym_members").update({ status: "inactive" }).eq("user_id", f.a.id).eq("gym_id", gym)).error).toBeNull();
    expect((await booking(f.first.id)).status).toBe("cancelled");
    expect((await booking(f.waiting.id)).status).toBe("cancelled");
    expect((await booking(nextBooking.data.id)).status).toBe("booked");
    expect((await f.a.client.from("workouts").select("id")).data).toEqual([]);
    expect((await f.a.client.rpc("book_class", { p_session: f.session.id })).error?.message).toBe("not_a_member");
  });

  it("freezing one plan leaves places that another plan still covers", async () => {
    const today = (await db.rpc("gym_today", { p_gym: gym })).data as string;
    const until = new Date(`${today}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 14);
    const athlete = await newAthlete("two-plans");
    const pack = await makeMember(athlete.id, { credits: 3 });
    const open = await newSession(2);
    const full = await newSession(1);
    const holder = await newAthlete("two-plans-holder"); await makeMember(holder.id);
    expect((await holder.client.rpc("book_class", { p_session: full.id })).error).toBeNull();

    // booked on the pack before the recurring plan exists, and waitlisted on a full class
    const paid = await athlete.client.rpc("book_class", { p_session: open.id });
    const waiting = await athlete.client.rpc("book_class", { p_session: full.id });
    expect(paid.data.membership_id).toBe(pack.id); expect(waiting.data.status).toBe("waitlisted");
    const recurring = await makeMember(athlete.id);

    const frozen = await db.rpc("freeze_membership", { p_user: athlete.id, p_membership: recurring.id, p_until: until.toISOString().slice(0, 10) });
    expect(frozen.error).toBeNull();
    expect(frozen.data.released_bookings).toBe(0);
    expect((await booking(paid.data.id)).status).toBe("booked");
    expect((await booking(waiting.data.id)).status).toBe("waitlisted");
    expect((await db.from("memberships").select("credits_remaining").eq("id", pack.id).single()).data?.credits_remaining).toBe(2);
  });

  it("takes an athlete off waitlists when their last membership ends, but not while another covers the class", async () => {
    const holder = await newAthlete("waitlist-holder"); await makeMember(holder.id);
    const session = await newSession(1);
    expect((await holder.client.rpc("book_class", { p_session: session.id })).error).toBeNull();

    const covered = await newAthlete("waitlist-covered");
    const first = await makeMember(covered.id); await makeMember(covered.id, { credits: 2 });
    const lone = await newAthlete("waitlist-lone");
    const only = await makeMember(lone.id);
    const keeps = await covered.client.rpc("book_class", { p_session: session.id });
    const leaves = await lone.client.rpc("book_class", { p_session: session.id });
    expect(keeps.data.status).toBe("waitlisted"); expect(leaves.data.status).toBe("waitlisted");

    expect((await db.from("memberships").update({ status: "cancelled" }).eq("id", first.id)).error).toBeNull();
    expect((await db.from("memberships").update({ status: "cancelled" }).eq("id", only.id)).error).toBeNull();
    expect((await booking(keeps.data.id)).status).toBe("waitlisted");
    expect((await booking(leaves.data.id)).status).toBe("cancelled");
  });
});
