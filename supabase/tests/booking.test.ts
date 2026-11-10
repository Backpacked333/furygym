import { describe, expect, it } from "vitest";
import { makeMember, newAthlete, newSession, service, signIn } from "./helpers";

const credits = async (membershipId: string) =>
  (await service().from("memberships").select("credits_remaining").eq("id", membershipId).single()).data!
    .credits_remaining;

describe("book_class", () => {
  it("requires a signed waiver and an entitlement", async () => {
    const session = await newSession(5);
    const athlete = await newAthlete("gate");

    const noWaiver = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(noWaiver.error?.message).toBe("waiver_required");

    const { data: waiver } = await athlete.client.from("waivers").select("id").eq("required", true).single();
    const signed = await athlete.client.rpc("sign_waiver", { p_waiver: waiver!.id, p_signed_name: "Gate Test" });
    expect(signed.error).toBeNull();
    expect(signed.data.signed_name).toBe("Gate Test");

    const noPlan = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(noPlan.error?.message).toBe("no_entitlement");

    await makeMember(athlete.id, { sign: false });
    const ok = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(ok.error).toBeNull();
    expect(ok.data.status).toBe("booked");

    // booking twice returns the same booking rather than a duplicate
    const again = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(again.data.id).toBe(ok.data.id);
  });

  it("rejects classes that have started, are cancelled, or are outside the booking window", async () => {
    const athlete = await newAthlete("window");
    await makeMember(athlete.id);

    const past = await newSession(5, -1);
    expect((await athlete.client.rpc("book_class", { p_session: past.id })).error?.message).toBe("session_started");

    const far = await newSession(5, 24 * 40);
    expect((await athlete.client.rpc("book_class", { p_session: far.id })).error?.message).toBe("booking_not_open");

    const cancelled = await newSession(5);
    await service().from("class_sessions").update({ status: "cancelled" }).eq("id", cancelled.id);
    expect((await athlete.client.rpc("book_class", { p_session: cancelled.id })).error?.message).toBe(
      "session_cancelled",
    );
  });

  it("never overbooks when many athletes book at the same moment", async () => {
    const session = await newSession(3);
    const athletes = await Promise.all(Array.from({ length: 8 }, (_, i) => newAthlete(`race${i}`)));
    await Promise.all(athletes.map((a) => makeMember(a.id)));

    const results = await Promise.all(athletes.map((a) => a.client.rpc("book_class", { p_session: session.id })));
    expect(results.every((r) => r.error === null)).toBe(true);
    const statuses = results.map((r) => r.data.status);
    expect(statuses.filter((s) => s === "booked")).toHaveLength(3);
    expect(statuses.filter((s) => s === "waitlisted")).toHaveLength(5);

    const overview = await athletes[0].client
      .from("class_session_overview")
      .select("booked_count, waitlist_count, my_booking_status")
      .eq("id", session.id)
      .single();
    expect(overview.data!.booked_count).toBe(3);
    expect(overview.data!.waitlist_count).toBe(5);
  });

  it("uses a class credit only when a seat is assigned, and returns it on a timely cancel", async () => {
    const session = await newSession(1);
    const first = await newAthlete("pack1");
    const second = await newAthlete("pack2");
    const m1 = await makeMember(first.id, { credits: 3 });
    const m2 = await makeMember(second.id, { credits: 3 });

    const b1 = await first.client.rpc("book_class", { p_session: session.id });
    expect(b1.data.status).toBe("booked");
    expect(await credits(m1.id)).toBe(2);
    const mine = await first.client.from("class_session_overview").select("my_booking_status, my_waitlist_position").eq("id", session.id).single();
    expect(mine.data).toEqual({ my_booking_status: "booked", my_waitlist_position: null });

    const b2 = await second.client.rpc("book_class", { p_session: session.id });
    expect(b2.data.status).toBe("waitlisted");
    expect(await credits(m2.id)).toBe(3); // waitlist place is free

    const overview = await second.client
      .from("class_session_overview")
      .select("my_booking_status, my_waitlist_position")
      .eq("id", session.id)
      .single();
    expect(overview.data).toEqual({ my_booking_status: "waitlisted", my_waitlist_position: 1 });

    // first athlete cancels well before the cutoff: credit back, waitlist promoted and charged
    const cancel = await first.client.rpc("cancel_booking", { p_booking: b1.data.id });
    expect(cancel.data.status).toBe("cancelled");
    expect(cancel.data.late_cancel).toBe(false);
    expect(await credits(m1.id)).toBe(3);

    const promoted = await service().from("bookings").select("status, credit_used").eq("id", b2.data.id).single();
    expect(promoted.data).toEqual({ status: "booked", credit_used: true });
    expect(await credits(m2.id)).toBe(2);
  });

  it("keeps the credit on a late cancel", async () => {
    // class starts in 30 minutes; the cutoff is 60
    const session = await newSession(4, 0.5);
    const athlete = await newAthlete("late");
    const membership = await makeMember(athlete.id, { credits: 2 });

    const booking = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(await credits(membership.id)).toBe(1);
    const cancel = await athlete.client.rpc("cancel_booking", { p_booking: booking.data.id });
    expect(cancel.data.late_cancel).toBe(true);
    expect(await credits(membership.id)).toBe(1);
  });

  it("skips a waitlisted athlete whose pack has run out", async () => {
    const session = await newSession(1);
    const holder = await newAthlete("holder");
    const broke = await newAthlete("broke");
    const next = await newAthlete("next");
    await makeMember(holder.id);
    const brokeMembership = await makeMember(broke.id, { credits: 1 });
    await makeMember(next.id);

    const held = await holder.client.rpc("book_class", { p_session: session.id });
    const brokeBooking = await broke.client.rpc("book_class", { p_session: session.id });
    const nextBooking = await next.client.rpc("book_class", { p_session: session.id });
    expect([brokeBooking.data.status, nextBooking.data.status]).toEqual(["waitlisted", "waitlisted"]);

    await service().from("memberships").update({ credits_remaining: 0 }).eq("id", brokeMembership.id);
    await holder.client.rpc("cancel_booking", { p_booking: held.data.id });

    const admin = service();
    expect((await admin.from("bookings").select("status").eq("id", brokeBooking.data.id).single()).data!.status).toBe(
      "waitlisted",
    );
    expect((await admin.from("bookings").select("status").eq("id", nextBooking.data.id).single()).data!.status).toBe(
      "booked",
    );
  });

  it("stops athletes touching other people's bookings and lets staff manage them", async () => {
    const session = await newSession(5);
    const a = await newAthlete("own");
    const b = await newAthlete("other");
    await makeMember(a.id);
    const booking = await a.client.rpc("book_class", { p_session: session.id });

    expect((await b.client.rpc("cancel_booking", { p_booking: booking.data.id })).error).not.toBeNull();
    expect((await b.client.rpc("book_class", { p_session: session.id, p_user: a.id })).error).not.toBeNull();
    expect((await a.client.rpc("check_in", { p_booking: booking.data.id })).error).not.toBeNull();
    expect((await b.client.from("bookings").select("id").eq("id", booking.data.id)).data).toHaveLength(0);

    const coach = await signIn("coach@furyco.test");
    const checked = await coach.rpc("check_in", { p_booking: booking.data.id });
    expect(checked.data.status).toBe("attended");
    expect(checked.data.checked_in_at).not.toBeNull();

    // staff can add a walk-in with no membership
    const walkIn = await coach.rpc("book_class", { p_session: session.id, p_user: b.id });
    expect(walkIn.error).toBeNull();
    expect(walkIn.data.status).toBe("booked");

    // athletes cannot write bookings directly
    const direct = await a.client.from("bookings").update({ status: "attended" }).eq("id", booking.data.id);
    expect(direct.error).not.toBeNull();
  });
});

describe("generate_sessions", () => {
  it("is admin-only and safe to run twice", async () => {
    const admin = service();
    const { data: gym } = await admin.from("gyms").select("id").eq("is_default", true).single();
    const owner = await signIn("owner@furyco.test");
    const athlete = await signIn("alex@furyco.test");
    const from = "2031-03-03"; // a Monday, far from seeded data
    const to = "2031-03-09";

    expect((await athlete.rpc("generate_sessions", { p_gym: gym!.id, p_from: from, p_to: to })).error).not.toBeNull();

    const first = await owner.rpc("generate_sessions", { p_gym: gym!.id, p_from: from, p_to: to });
    expect(first.data).toBe(16); // 3 classes x 5 weekdays + Saturday
    const second = await owner.rpc("generate_sessions", { p_gym: gym!.id, p_from: from, p_to: to });
    expect(second.data).toBe(0);

    // 06:00 Chicago on 3 March 2031 (CST, UTC-6) is 12:00 UTC
    const { data: six } = await admin
      .from("class_sessions")
      .select("starts_at")
      .eq("title", "Strength 6AM")
      .gte("starts_at", "2031-03-03T00:00:00Z")
      .lt("starts_at", "2031-03-04T00:00:00Z")
      .single();
    expect(new Date(six!.starts_at).toISOString()).toBe("2031-03-03T12:00:00.000Z");

    await admin.from("class_sessions").delete().gte("starts_at", "2031-01-01T00:00:00Z");
  });
});
