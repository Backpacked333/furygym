import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addDays, anon, gymId, makeMember, newAthlete, newSession, service, signIn } from "./helpers";

const codeFor = (secret: string, offsetWindows = 0) =>
  createHmac("sha256", secret).update(String(Math.floor(Date.now() / 30_000) + offsetWindows)).digest("hex").slice(0, 10);

describe("QR check-in", () => {
  it("checks an athlete in to their upcoming class from a fresh code, and rejects stale or forged ones", async () => {
    const coach = await signIn("coach@furyco.test");
    const athlete = await newAthlete("qr");
    await makeMember(athlete.id);
    const session = await newSession(10, 0.5); // starts in 30 minutes
    const booking = await athlete.client.rpc("book_class", { p_session: session.id });
    expect(booking.data.status).toBe("booked");

    const { data: secret } = await athlete.client.rpc("my_checkin_secret");
    expect(secret).toMatch(/^[0-9a-f]{40}$/);
    expect((await athlete.client.rpc("my_checkin_secret")).data).toBe(secret); // stable once created

    // an hour-old code (a screenshot) does not work
    const stale = await coach.rpc("check_in_with_code", { p_payload: `FC1:${athlete.id}:${codeFor(secret, -120)}` });
    expect(stale.data.result).toBe("expired_code");
    // nor does a code made with someone else's secret, or junk
    const other = await newAthlete("qr-other");
    const otherSecret = (await other.client.rpc("my_checkin_secret")).data;
    expect((await coach.rpc("check_in_with_code", { p_payload: `FC1:${athlete.id}:${codeFor(otherSecret)}` })).data.result).toBe("expired_code");
    expect((await coach.rpc("check_in_with_code", { p_payload: "hello" })).data.result).toBe("invalid_code");
    expect((await coach.rpc("check_in_with_code", { p_payload: `FC1:not-a-uuid:abc` })).data.result).toBe("invalid_code");

    const ok = await coach.rpc("check_in_with_code", { p_payload: `FC1:${athlete.id}:${codeFor(secret)}` });
    expect(ok.data).toMatchObject({ result: "checked_in", athlete: "Test qr", class: session.title });
    const row = await service().from("bookings").select("status, checked_in_at").eq("id", booking.data.id).single();
    expect(row.data!.status).toBe("attended");
    expect(row.data!.checked_in_at).not.toBeNull();

    // scanning twice is harmless; the previous 30-second window is still accepted
    const again = await coach.rpc("check_in_with_code", { p_payload: `FC1:${athlete.id}:${codeFor(secret, -1)}` });
    expect(again.data.result).toBe("already_checked_in");

    expect((await athlete.client.rpc("my_attendance")).data).toMatchObject({ visits: 1, visits_this_month: 1 });
  });

  it("tells staff when the athlete has no class to check in to, and is staff-only", async () => {
    const coach = await signIn("coach@furyco.test");
    const athlete = await newAthlete("qr-none");
    const secret = (await athlete.client.rpc("my_checkin_secret")).data;
    const payload = `FC1:${athlete.id}:${codeFor(secret)}`;

    const none = await coach.rpc("check_in_with_code", { p_payload: payload });
    expect(none.data).toMatchObject({ result: "no_booking", athlete: "Test qr-none" });

    expect((await athlete.client.rpc("check_in_with_code", { p_payload: payload })).error).not.toBeNull();
    // secrets are private to their owner
    const peek = await coach.from("checkin_secrets").select("secret").eq("user_id", athlete.id);
    expect(peek.data).toHaveLength(0);
  });
});

describe("membership freeze", () => {
  it("can only be done by the server, releases bookings in the window, and ends on its own", async () => {
    const admin = service();
    const gym = await gymId();
    const today = (await admin.rpc("gym_today", { p_gym: gym })).data as string;
    const athlete = await newAthlete("freeze");
    const membership = await makeMember(athlete.id);
    const waiting = await newAthlete("freeze-wait");
    await makeMember(waiting.id);

    const soon = await newSession(1, 48);
    const later = await newSession(5, 24 * 12);
    const b1 = await athlete.client.rpc("book_class", { p_session: soon.id });
    const w1 = await waiting.client.rpc("book_class", { p_session: soon.id });
    await athlete.client.rpc("book_class", { p_session: later.id });
    expect(w1.data.status).toBe("waitlisted");

    // athletes cannot call it themselves: billing has to be paused first
    const direct = await athlete.client.rpc("freeze_membership", { p_user: athlete.id, p_membership: membership.id, p_until: addDays(today, 10) });
    expect(direct.error).not.toBeNull();

    expect((await admin.rpc("freeze_membership", { p_user: athlete.id, p_membership: membership.id, p_until: addDays(today, 3) })).error?.message).toBe("invalid_freeze_length");
    const other = await newAthlete("freeze-other");
    expect((await admin.rpc("freeze_membership", { p_user: other.id, p_membership: membership.id, p_until: addDays(today, 10) })).error?.message).toBe("membership_not_found");

    const frozen = await admin.rpc("freeze_membership", { p_user: athlete.id, p_membership: membership.id, p_until: addDays(today, 10) });
    expect(frozen.error).toBeNull();
    expect(frozen.data).toEqual({ frozen_until: addDays(today, 10), released_bookings: 1 });

    // the class inside the window is released and the waitlist moves up; the later class is kept
    expect((await admin.from("bookings").select("status").eq("id", b1.data.id).single()).data!.status).toBe("cancelled");
    expect((await admin.from("bookings").select("status").eq("id", w1.data.id).single()).data!.status).toBe("booked");
    const kept = await admin.from("bookings").select("status").eq("session_id", later.id).eq("user_id", athlete.id).single();
    expect(kept.data!.status).toBe("booked");

    // no facility access or new bookings during the freeze…
    expect((await athlete.client.rpc("has_facility_access", { p_gym: gym })).data).toBe(false);
    const during = await newSession(5, 72);
    expect((await athlete.client.rpc("book_class", { p_session: during.id })).error?.message).toBe("no_entitlement");
    // …but a class after the resume date can be booked now
    const after = await newSession(5, 24 * 13);
    expect((await athlete.client.rpc("book_class", { p_session: after.id })).data.status).toBe("booked");

    // once the resume date arrives the membership works again without anyone touching it
    await admin.from("memberships").update({ frozen_until: today }).eq("id", membership.id);
    expect((await athlete.client.rpc("has_facility_access", { p_gym: gym })).data).toBe(true);
    expect((await athlete.client.rpc("book_class", { p_session: during.id })).data.status).toBe("booked");
  });
});

describe("gym display v2", () => {
  it("shows the next class with a headcount, and names only when staff switch them on", async () => {
    const admin = service();
    const gym = await gymId();
    const coach = await signIn("coach@furyco.test");
    const athlete = await newAthlete("display");
    await admin.from("profiles").update({ full_name: "Dana Marie Display" }).eq("id", athlete.id);
    await makeMember(athlete.id);

    const start = new Date(Date.now() + 20 * 60_000);
    const { data: session } = await admin
      .from("class_sessions")
      .insert({ gym_id: gym, title: "Display Test Class", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600_000).toISOString(), capacity: 8 })
      .select()
      .single();
    const booking = await athlete.client.rpc("book_class", { p_session: session!.id });
    await coach.rpc("check_in", { p_booking: booking.data.id });

    const show = async () => (await anon().rpc("get_display", { p_token: "demo-display-token" })).data;
    let data = await show();
    expect(data.timezone).toBe("America/Chicago");
    expect(data.next_class).toMatchObject({ title: "Display Test Class", capacity: 8, booked: 1, checked_in: 1, checked_in_names: [] });

    await coach.from("display_state").update({ show_checked_in: true }).eq("gym_id", gym);
    data = await show();
    expect(data.next_class.checked_in_names).toEqual(["Dana D."]); // first name, last initial only

    await coach.from("display_state").update({ mode: "off" }).eq("gym_id", gym);
    expect((await show()).next_class).toBeNull();

    await coach.from("display_state").update({ mode: "auto", show_checked_in: false }).eq("gym_id", gym);
    await admin.from("class_sessions").delete().eq("id", session!.id);
  });

  it("uses the design system's track colours and exposes the milestone setting", async () => {
    const { data: tracks } = await anon().from("tracks").select("slug, color").order("position");
    expect(tracks).toEqual([
      { slug: "strength", color: "#FF4245" },
      { slug: "engine", color: "#FF9230" },
      { slug: "selection", color: "#6D7CFF" },
    ]);
    const { data: gym } = await anon().from("gyms").select("milestone_visits, milestone_reward").single();
    expect(gym).toEqual({ milestone_visits: 20, milestone_reward: "a free Fury Co. tee" });
  });
});
