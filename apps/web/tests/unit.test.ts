import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { classTimer, clockOffset, screenStatus } from "@/lib/display";
import { addDays, dateInZone, startOfWeek, zonedToUtc } from "@/lib/format";
import { everyRow } from "@/lib/paging";
import { buildCheckoutSession, validStartDate } from "@/lib/stripe/checkout";
import { publishState, workoutSchema } from "@/lib/workouts";

describe("gym-time helpers", () => {
  it("rejects missing and ambiguous wall-clock times when scheduling", () => {
    expect(() => zonedToUtc("2027-03-14", "02:30", "America/Chicago", "reject")).toThrow("does not exist");
    expect(() => zonedToUtc("2027-11-07", "01:30", "America/Chicago", "reject")).toThrow("occurs twice");
    expect(() => zonedToUtc("2027-10-03", "02:15", "Australia/Lord_Howe", "reject")).toThrow("does not exist");
    expect(() => zonedToUtc("2011-12-30", "12:00", "Pacific/Apia", "reject")).toThrow("does not exist");
    expect(zonedToUtc("2027-03-14", "03:30", "America/Chicago", "reject").toISOString()).toBe("2027-03-14T08:30:00.000Z");
    expect(zonedToUtc("2027-01-15", "09:00", "Asia/Kathmandu", "reject").toISOString()).toBe("2027-01-15T03:15:00.000Z");
  });

  it("does not normalize invalid calendar input into another day", () => {
    expect(() => zonedToUtc("2027-02-30", "12:00", "UTC", "reject")).toThrow("valid date");
    expect(() => zonedToUtc("2027-03-14", "24:30", "UTC", "reject")).toThrow("valid date");
    expect(() => zonedToUtc("invalid", "12:00", "UTC", "reject")).toThrow("valid date");
  });

  it("converts gym wall-clock time to an instant, either side of daylight saving", () => {
    expect(zonedToUtc("2026-11-10", "18:00", "America/Chicago").toISOString()).toBe("2026-11-11T00:00:00.000Z"); // CST, UTC-6
    expect(zonedToUtc("2026-07-10", "06:00", "America/Chicago").toISOString()).toBe("2026-07-10T11:00:00.000Z"); // CDT, UTC-5
    expect(zonedToUtc("2026-11-01", "00:30", "America/Chicago").toISOString()).toBe("2026-11-01T05:30:00.000Z"); // before fall-back
    expect(zonedToUtc("2026-11-01", "06:00", "America/Chicago").toISOString()).toBe("2026-11-01T12:00:00.000Z"); // after fall-back
    expect(zonedToUtc("2026-03-08", "06:00", "America/Chicago").toISOString()).toBe("2026-03-08T11:00:00.000Z"); // after spring-forward
    expect(zonedToUtc("2026-01-15", "09:00", "UTC").toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("works out the gym's calendar date and week", () => {
    expect(dateInZone(new Date("2026-11-11T03:00:00Z"), "America/Chicago")).toBe("2026-11-10");
    expect(dateInZone(new Date("2026-11-11T07:00:00Z"), "America/Chicago")).toBe("2026-11-11");
    expect(startOfWeek("2026-11-10")).toBe("2026-11-09"); // Tuesday → Monday
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09"); // Sunday belongs to the week that started Monday
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("workout publishing", () => {
  it("distinguishes draft, scheduled and live", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(publishState({ status: "draft", publish_at: null }, now)).toBe("draft");
    expect(publishState({ status: "published", publish_at: "2026-11-10T11:59:00Z" }, now)).toBe("live");
    expect(publishState({ status: "published", publish_at: "2026-11-10T18:00:00Z" }, now)).toBe("scheduled");
  });

  it("validates the builder payload and normalises blanks", () => {
    const parsed = workoutSchema.parse({
      id: "", title: "  Squat Day ", track_id: "", scheduled_date: "2026-11-12", description: "", publish: "draft",
      items: [{ title: "Back Squat", metrics: ["load", "reps"], video_url: "", exercise_id: "" }],
    });
    expect(parsed.title).toBe("Squat Day");
    expect(parsed.id).toBeNull();
    expect(parsed.items[0].video_url).toBeNull();

    expect(workoutSchema.safeParse({ title: "", publish: "draft", items: [] }).success).toBe(false);
    expect(workoutSchema.safeParse({ title: "X", publish: "draft", items: [{ title: "Y", metrics: ["heart_rate"] }] }).success).toBe(false);
    expect(workoutSchema.safeParse({ title: "X", publish: "draft", items: [{ title: "Y", metrics: [], video_url: "not a url" }] }).success).toBe(false);
  });
});

describe("checkout", () => {
  const ctx = { userId: "user-1", gymId: "gym-1", customerId: "cus_1", siteUrl: "https://app.example.com", returnTo: "web" as const, automaticTax: false };
  const plan = { id: "plan-1", name: "Unlimited Monthly", kind: "recurring", price_cents: 18500, currency: "usd", billing_interval: "month", stripe_price_id: null } as never;
  const pack = { id: "plan-2", name: "10 Class Pack", kind: "class_pack", price_cents: 20000, currency: "usd", billing_interval: null, stripe_price_id: "price_123" } as never;
  const program = { id: "prog-1", name: "Selection Prep", price_cents: 14900, currency: "usd", stripe_price_id: null } as never;

  it("builds a subscription for recurring plans, with metadata the webhook can act on", () => {
    const session = buildCheckoutSession({ kind: "plan", plan }, ctx);
    expect(session.mode).toBe("subscription");
    expect(session.line_items![0].price_data).toMatchObject({ unit_amount: 18500, currency: "usd", recurring: { interval: "month" }, product_data: { name: "Unlimited Monthly" } });
    expect(session.metadata).toEqual({ kind: "plan", user_id: "user-1", gym_id: "gym-1", plan_id: "plan-1", plan_kind: "recurring" });
    expect(session.subscription_data?.metadata).toEqual(session.metadata);
    expect(session.payment_intent_data).toBeUndefined();
    expect(session.automatic_tax).toBeUndefined();
    expect(session.success_url).toBe("https://app.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}&return=web");
  });

  it("uses a one-time payment and a configured Stripe price for packs", () => {
    const session = buildCheckoutSession({ kind: "plan", plan: pack }, { ...ctx, automaticTax: true });
    expect(session.mode).toBe("payment");
    expect(session.line_items).toEqual([{ price: "price_123", quantity: 1 }]);
    expect(session.payment_intent_data?.metadata).toMatchObject({ plan_id: "plan-2" });
    expect(session.automatic_tax).toEqual({ enabled: true });
  });

  it("carries the start date for programs and returns iOS buyers to the app", () => {
    const session = buildCheckoutSession({ kind: "program", program, startDate: "2026-12-01" }, { ...ctx, returnTo: "app" });
    expect(session.mode).toBe("payment");
    expect(session.metadata).toEqual({ kind: "program", user_id: "user-1", gym_id: "gym-1", program_id: "prog-1", start_date: "2026-12-01" });
    expect(session.success_url).toContain("return=app");
    expect(session.cancel_url).toBe("https://app.example.com/checkout/cancelled?return=app");
  });

  it("accepts start dates from today to 90 days out", () => {
    expect(validStartDate(undefined, "2026-11-10")).toBe("2026-11-10");
    expect(validStartDate("2026-11-10", "2026-11-10")).toBe("2026-11-10");
    expect(validStartDate("2027-02-08", "2026-11-10")).toBe("2027-02-08");
    expect(validStartDate("2027-02-09", "2026-11-10")).toBeNull();
    expect(validStartDate("2026-11-09", "2026-11-10")).toBeNull();
    expect(validStartDate("next week", "2026-11-10")).toBeNull();
  });
});

describe("csv export", () => {
  it("quotes awkward values and defuses spreadsheet formulas", () => {
    expect(toCsv(["name", "note", "amount"], [["O'Brien, Pat", 'said "hi"', 12.5], ["=SUM(A1)", null, 0]])).toBe(
      'name,note,amount\r\n"O\'Brien, Pat","said ""hi""",12.5\r\n\'=SUM(A1),,0\r\n',
    );
    // negative amounts are numbers, not formulas
    expect(toCsv(["net", "note"], [["-1.03", "-cmd|' /C calc'!A0"]])).toBe("net,note\r\n-1.03,'-cmd|' /C calc'!A0\r\n");
  });
});

describe("gym display", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const session = { starts_at: "2026-11-12T12:00:00Z", ends_at: "2026-11-12T13:30:00Z" };

  it("counts down to a class, shows it in progress until it ends, then drops it", () => {
    expect(classTimer(session, at("2026-11-12T10:54:55Z"))).toEqual({ label: "Starts in", value: "1:05:05", live: false });
    expect(classTimer(session, at("2026-11-12T11:57:30Z"))).toEqual({ label: "Starts in", value: "2:30", live: false });
    expect(classTimer(session, at("2026-11-12T12:00:00Z"))).toMatchObject({ value: "In progress", live: true });
    // well past the old half-hour cut-off, a ninety-minute class is still running
    expect(classTimer(session, at("2026-11-12T13:29:59Z"))).toMatchObject({ value: "In progress", live: true });
    expect(classTimer(session, at("2026-11-12T13:30:00Z"))).toBeNull();
  });

  it("corrects for a screen whose clock is wrong", () => {
    // the device thinks it is 11:00; the server answered 12:00:00.5 to a request that took one second
    const sent = at("2026-11-12T11:00:00Z");
    expect(clockOffset("2026-11-12T12:00:00.500Z", sent, sent + 1000)).toBe(3_600_000);
    expect(clockOffset(undefined, sent, sent)).toBeNull();
    expect(clockOffset("not a time", sent, sent)).toBeNull();
  });

  it("reports a screen as connected only while it keeps checking in", () => {
    const now = at("2026-11-12T12:00:00Z");
    expect(screenStatus(null, now)).toBe("never");
    expect(screenStatus("2026-11-12T11:59:20Z", now)).toBe("online");
    expect(screenStatus("2026-11-12T11:58:29Z", now)).toBe("offline");
  });
});

describe("reading every row of a capped query", () => {
  const source = (total: number) => {
    const calls: [number, number][] = [];
    const page = async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null };
    };
    return { calls, page };
  };

  it("keeps reading past the first page, in order, with no gap or repeat", async () => {
    const { calls, page } = source(2500);
    const rows = await everyRow(page);
    expect(rows).toHaveLength(2500);
    expect(rows).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more after an exactly full page, and stops on a short one", async () => {
    expect((await everyRow(source(1000).page)).length).toBe(1000);
    expect(await everyRow(source(0).page)).toEqual([]);
    const { calls, page } = source(1000);
    await everyRow(page);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("fails instead of returning the rows it managed to read", async () => {
    let n = 0;
    const page = async () => (n++ === 0 ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null } : { data: null, error: { message: "timeout" } });
    await expect(everyRow(page)).rejects.toThrow("timeout");
  });
});
