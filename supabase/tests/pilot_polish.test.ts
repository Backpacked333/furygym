import { beforeAll, describe, expect, it } from "vitest";
import { anon, gymId, makeMember, newAthlete, newSession, service, signIn } from "./helpers";

let gym: string;
let owner: Awaited<ReturnType<typeof signIn>>;
let coach: Awaited<ReturnType<typeof signIn>>;
const db = service();
beforeAll(async () => {
  gym = await gymId();
  owner = await signIn("owner@furyco.test");
  coach = await signIn("coach@furyco.test");
});

/** Records visits the way a check-in does, on classes that have already run. */
async function attend(userId: string, visits: number, hoursAgo = 30) {
  for (let i = 0; i < visits; i++) {
    const session = await newSession(5, -(hoursAgo + i));
    const { error } = await db.from("bookings").insert({ gym_id: gym, session_id: session.id, user_id: userId, status: "attended", checked_in_at: session.starts_at });
    if (error) throw error;
  }
}

describe("class cancelled by the gym", () => {
  it("marks the bookings it releases, so the athlete's app can say so and staff know who to tell", async () => {
    const booked = await newAthlete("cancel-booked");
    const waiting = await newAthlete("cancel-waiting");
    const bystander = await newAthlete("cancel-bystander");
    const pack = await makeMember(booked.id, { credits: 3 });
    await makeMember(waiting.id);
    await makeMember(bystander.id);
    const session = await newSession(1);
    const place = await booked.client.rpc("book_class", { p_session: session.id });
    const queued = await waiting.client.rpc("book_class", { p_session: session.id });
    expect(place.error).toBeNull();
    expect(queued.data.status).toBe("waitlisted");

    const before = await booked.client.from("class_session_overview").select("my_class_cancelled").eq("id", session.id).single();
    expect(before.data?.my_class_cancelled).toBe(false);

    const cancelled = await owner.from("class_sessions").update({ status: "cancelled" }).eq("id", session.id);
    expect(cancelled.error).toBeNull();

    const { data: rows } = await db.from("bookings").select("user_id, status, class_cancelled, credit_used").eq("session_id", session.id);
    expect(rows).toHaveLength(2);
    for (const row of rows!) expect(row).toMatchObject({ status: "cancelled", class_cancelled: true, credit_used: false });
    expect((await db.from("memberships").select("credits_remaining").eq("id", pack.id).single()).data?.credits_remaining).toBe(3);

    for (const athlete of [booked, waiting]) {
      const mine = await athlete.client.from("class_session_overview").select("status, my_class_cancelled, my_booking_status").eq("id", session.id).single();
      expect(mine.data).toEqual({ status: "cancelled", my_class_cancelled: true, my_booking_status: null });
    }
    const other = await bystander.client.from("class_session_overview").select("my_class_cancelled").eq("id", session.id).single();
    expect(other.data?.my_class_cancelled).toBe(false);
  });

  it("does not flag a booking the athlete cancelled themselves before the class was cancelled", async () => {
    const athlete = await newAthlete("self-cancel");
    await makeMember(athlete.id);
    const session = await newSession(3);
    const place = await athlete.client.rpc("book_class", { p_session: session.id });
    expect((await athlete.client.rpc("cancel_booking", { p_booking: place.data.id })).error).toBeNull();
    expect((await owner.from("class_sessions").update({ status: "cancelled" }).eq("id", session.id)).error).toBeNull();
    expect((await db.from("bookings").select("class_cancelled").eq("id", place.data.id).single()).data?.class_cancelled).toBe(false);
    const mine = await athlete.client.from("class_session_overview").select("my_class_cancelled").eq("id", session.id).single();
    expect(mine.data?.my_class_cancelled).toBe(false);
  });
});

describe("members who have gone quiet", () => {
  it("lists active members with no visit in the period, for staff only", async () => {
    const quiet = await newAthlete("quiet");
    const regular = await newAthlete("regular");
    const fresh = await newAthlete("fresh");
    const lapsed = await newAthlete("lapsed");
    const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (const athlete of [quiet, regular, lapsed]) {
      const membership = await makeMember(athlete.id);
      await db.from("memberships").update({ started_at: longAgo }).eq("id", membership.id);
    }
    await makeMember(fresh.id); // joined today: too soon to call quiet
    await attend(lapsed.id, 1, 20 * 24);
    await attend(regular.id, 1, 30);

    const list = await coach.rpc("quiet_members", { p_gym: gym, p_days: 14 });
    expect(list.error).toBeNull();
    const ids = (list.data as { user_id: string; last_visit: string | null }[]).map((m) => m.user_id);
    expect(ids).toContain(quiet.id);
    expect(ids).toContain(lapsed.id);
    expect(ids).not.toContain(regular.id);
    expect(ids).not.toContain(fresh.id);
    expect(list.data.find((m: { user_id: string }) => m.user_id === quiet.id).last_visit).toBeNull();
    expect(list.data.find((m: { user_id: string }) => m.user_id === lapsed.id).last_visit).not.toBeNull();

    expect((await quiet.client.rpc("quiet_members", { p_gym: gym, p_days: 14 })).data).toEqual([]);
    expect((await anon().rpc("quiet_members", { p_gym: gym, p_days: 14 })).error).not.toBeNull();
  });
});

describe("attendance rewards", () => {
  it("lists athletes who reached the milestone until staff record the reward, then again at the next one", async () => {
    const athlete = await newAthlete("milestone");
    const short = await newAthlete("almost");
    await db.from("gyms").update({ milestone_visits: 3 }).eq("id", gym);
    try {
      await attend(athlete.id, 4);
      await attend(short.id, 2);
      const due = async (client = owner) => ((await client.rpc("milestones_due", { p_gym: gym })).data ?? []) as { user_id: string; visits: number; milestone: number }[];

      expect((await due()).find((d) => d.user_id === athlete.id)).toMatchObject({ visits: 4, milestone: 3 });
      expect((await due()).some((d) => d.user_id === short.id)).toBe(false);
      expect(await due(athlete.client)).toEqual([]);

      // an athlete cannot record their own reward, and staff cannot record it in someone else's name
      const self = await athlete.client.from("milestone_rewards").insert({ gym_id: gym, user_id: athlete.id, visits: 3, given_by: athlete.id });
      expect(self.error).not.toBeNull();
      const forged = await coach.from("milestone_rewards").insert({ gym_id: gym, user_id: athlete.id, visits: 3, given_by: athlete.id });
      expect(forged.error).not.toBeNull();

      const coachId = (await coach.auth.getUser()).data.user!.id;
      const given = await coach.from("milestone_rewards").insert({ gym_id: gym, user_id: athlete.id, visits: 3, reward: "a free Fury Co. tee", given_by: coachId });
      expect(given.error).toBeNull();
      expect((await due()).some((d) => d.user_id === athlete.id)).toBe(false);
      expect((await coach.from("milestone_rewards").insert({ gym_id: gym, user_id: athlete.id, visits: 3, given_by: coachId })).error?.code).toBe("23505");
      expect((await athlete.client.from("milestone_rewards").select("visits, reward")).data).toEqual([{ visits: 3, reward: "a free Fury Co. tee" }]);
      expect((await short.client.from("milestone_rewards").select("visits")).data).toEqual([]);

      await attend(athlete.id, 2, 200);
      expect((await due()).find((d) => d.user_id === athlete.id)).toMatchObject({ visits: 6, milestone: 6 });
    } finally {
      await db.from("gyms").update({ milestone_visits: 20 }).eq("id", gym);
    }
  });
});

describe("privacy, terms and support text", () => {
  it("is public to read and only an owner or admin can change it", async () => {
    const athlete = await newAthlete("legal");
    const row = { gym_id: gym, support_email: "help@furyco.test", privacy_policy: "Test privacy text", terms: "Test terms text" };
    try {
      expect((await athlete.client.from("gym_legal").upsert(row)).error).not.toBeNull();
      expect((await coach.from("gym_legal").upsert(row)).error).not.toBeNull();
      expect((await anon().from("gym_legal").upsert(row)).error).not.toBeNull();
      expect((await owner.from("gym_legal").upsert(row)).error).toBeNull();

      const published = await anon().from("gym_legal").select("support_email, privacy_policy, terms").eq("gym_id", gym).single();
      expect(published.data).toEqual({ support_email: "help@furyco.test", privacy_policy: "Test privacy text", terms: "Test terms text" });

      await coach.from("gym_legal").update({ terms: "Changed by a coach" }).eq("gym_id", gym);
      expect((await anon().from("gym_legal").select("terms").eq("gym_id", gym).single()).data?.terms).toBe("Test terms text");
      expect((await owner.from("gym_legal").update({ terms: "Updated terms" }).eq("gym_id", gym)).error).toBeNull();
      expect((await anon().from("gym_legal").select("terms").eq("gym_id", gym).single()).data?.terms).toBe("Updated terms");
    } finally {
      await db.from("gym_legal").delete().eq("gym_id", gym);
    }
  });
});
