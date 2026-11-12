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
    const { data: track, error: trackError } = await admin.from("tracks").insert({ gym_id: gym, name: "Display test", slug: `display-test-${Date.now()}`, kind: "facility" }).select().single();
    if (trackError) throw trackError;

    const start = new Date(Date.now() + 20 * 60_000);
    const { data: session } = await admin
      .from("class_sessions")
      .insert({ gym_id: gym, track_id: track!.id, title: "Display Test Class", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600_000).toISOString(), capacity: 8 })
      .select()
      .single();
    const booking = await athlete.client.rpc("book_class", { p_session: session!.id });
    await coach.rpc("check_in", { p_booking: booking.data.id });

    await coach.from("display_state").update({ track_id: track!.id }).eq("gym_id", gym);
    try {
      const show = async () => (await anon().rpc("get_display", { p_token: "demo-display-token" })).data;
      let data = await show();
      expect(data.timezone).toBe("America/Chicago");
      expect(data.next_class).toMatchObject({ title: "Display Test Class", capacity: 8, booked: 1, checked_in: 1, checked_in_names: [] });

      await coach.from("display_state").update({ show_checked_in: true }).eq("gym_id", gym);
      data = await show();
      expect(data.next_class.checked_in_names).toEqual(["Dana D."]); // first name, last initial only

      await coach.from("display_state").update({ mode: "off" }).eq("gym_id", gym);
      expect((await show()).next_class).toBeNull();
    } finally {
      await coach.from("display_state").update({ mode: "auto", show_checked_in: false, track_id: null }).eq("gym_id", gym);
      await admin.from("class_sessions").delete().eq("id", session!.id);
      await admin.from("tracks").delete().eq("id", track!.id);
    }
  });

  it("keeps a class on screen until it ends, and hands over to the next one as athletes arrive", async () => {
    const admin = service();
    const gym = await gymId();
    const coach = await signIn("coach@furyco.test");
    const { data: track, error: trackError } = await admin.from("tracks").insert({ gym_id: gym, name: "Display timing", slug: `display-timing-${Date.now()}`, kind: "facility" }).select().single();
    if (trackError) throw trackError;
    const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
    const add = async (title: string, from: number, to: number) => {
      const { data, error } = await admin.from("class_sessions").insert({ gym_id: gym, track_id: track!.id, title, starts_at: minutes(from), ends_at: minutes(to), capacity: 8 }).select().single();
      if (error) throw error;
      return data!;
    };

    await coach.from("display_state").update({ track_id: track!.id }).eq("gym_id", gym);
    try {
      const show = async () => (await anon().rpc("get_display", { p_token: "demo-display-token" })).data;

      // a class that finished is never the current class
      await add("Display Finished", -120, -60);
      expect((await show()).next_class).toBeNull();

      // fifty minutes into a ninety-minute class, it is still the class on the floor
      const long = await add("Display Long Class", -50, 40);
      let data = await show();
      expect(data.next_class).toMatchObject({ title: "Display Long Class", starts_at: expect.any(String), ends_at: expect.any(String) });
      expect(new Date(data.next_class.ends_at).getTime()).toBe(new Date(long.ends_at).getTime());
      // screens count down against the server's clock
      expect(Math.abs(new Date(data.server_time).getTime() - Date.now())).toBeLessThan(60_000);

      // the next class does not take over while it is still a while away
      const following = await add("Display Following", 40, 100);
      expect((await show()).next_class.title).toBe("Display Long Class");

      // but does once athletes are arriving for it
      await admin.from("class_sessions").update({ starts_at: minutes(10) }).eq("id", following.id);
      expect((await show()).next_class.title).toBe("Display Following");

      // and it keeps the card once it starts, even though the earlier class is still running
      await admin.from("class_sessions").update({ starts_at: minutes(-1) }).eq("id", following.id);
      expect((await show()).next_class.title).toBe("Display Following");

      // a cancelled class is skipped
      await admin.from("class_sessions").update({ status: "cancelled" }).eq("id", following.id);
      expect((await show()).next_class.title).toBe("Display Long Class");
    } finally {
      await coach.from("display_state").update({ track_id: null }).eq("gym_id", gym);
      await admin.from("class_sessions").delete().eq("track_id", track!.id);
      await admin.from("tracks").delete().eq("id", track!.id);
    }
  });

  it("records when a screen last used the display link, only for the real link", async () => {
    const admin = service();
    const gym = await gymId();
    const seenAt = async () => (await admin.from("gym_secrets").select("display_seen_at").eq("gym_id", gym).single()).data!.display_seen_at as string | null;
    await admin.from("gym_secrets").update({ display_seen_at: null }).eq("gym_id", gym);

    expect((await anon().rpc("display_ping", { p_token: "not-the-token" })).error).toBeNull();
    expect(await seenAt()).toBeNull();

    expect((await anon().rpc("display_ping", { p_token: "demo-display-token" })).error).toBeNull();
    const first = await seenAt();
    expect(Math.abs(new Date(first!).getTime() - Date.now())).toBeLessThan(60_000);

    // several screens share one link: a second check-in moments later does not write again
    await anon().rpc("display_ping", { p_token: "demo-display-token" });
    expect(await seenAt()).toBe(first);

    // staff can read it for the console; athletes and the public cannot
    const coach = await signIn("coach@furyco.test");
    expect((await coach.from("gym_secrets").select("display_seen_at").eq("gym_id", gym)).data).toHaveLength(1);
    const athlete = await newAthlete("display-seen");
    expect((await athlete.client.from("gym_secrets").select("display_seen_at")).data ?? []).toHaveLength(0);
    expect((await anon().from("gym_secrets").select("display_seen_at")).data ?? []).toHaveLength(0);
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
